import test from 'node:test';
import assert from 'node:assert/strict';
import { atCut, cameraState, objectState, projectSchema, street } from '../src/previs/project.ts';

test('the sedan travels under the 0.15 m camera during the frog-eye shot',()=>{
  const car=street.stage.objects.find(o=>o.id==='car')!;
  const track=street.tracks.find(t=>t.objectId===car.id)!;
  const a=atCut(street,6),b=atCut(street,8.5),c=atCut(street,9);
  const camera=cameraState(street,b.shot,b.time);
  assert.equal(camera.position[1],.15);
  assert.ok(objectState(car,track,a.time).position[2]<camera.position[2]);
  assert.equal(objectState(car,track,b.time).position[2],camera.position[2]);
  assert.ok(objectState(car,track,c.time).position[2]>camera.position[2]);
});

test('camera cuts preserve blocking time and sampled car positions',()=>{
  const car=street.stage.objects.find(o=>o.id==='car')!;
  const tr=street.tracks.find(t=>t.objectId==='car')!;
  for(const cut of [3,6,10]){
    const before=atCut(street,cut-.0001),after=atCut(street,cut);
    assert.notEqual(before.shot.cameraId,after.shot.cameraId);
    assert.ok(Math.abs(before.time-after.time)<.001);
    assert.ok(Math.abs(objectState(car,tr,before.time).position[2]-objectState(car,tr,after.time).position[2])<.002);
  }
});

test('project JSON round trips and broken IDs are rejected',()=>{
  assert.deepEqual(projectSchema.parse(JSON.parse(JSON.stringify(street))),street);
  const invalid=structuredClone(street);invalid.shots[0].cameraId='missing';
  assert.equal(projectSchema.safeParse(invalid).success,false);
});

test('ease, hold and rotation are evaluated from the outgoing keyframe',()=>{
  const car=street.stage.objects.find(o=>o.id==='car')!;
  const track={objectId:car.id,action:'drive' as const,keys:[
    {time:0,position:[0,0,0] as [number,number,number],rotation:[0,0,0] as [number,number,number],interpolation:'hold' as const},
    {time:1,position:[4,0,0] as [number,number,number],rotation:[12,20,0] as [number,number,number],interpolation:'ease' as const},
    {time:3,position:[8,0,0] as [number,number,number],rotation:[0,40,0] as [number,number,number]},
  ]};
  assert.deepEqual(objectState(car,track,.75).position,[0,0,0]);
  assert.deepEqual(objectState(car,track,1).position,[4,0,0]);
  assert.deepEqual(objectState(car,track,1.5).position,[4.625,0,0]);
  assert.deepEqual(objectState(car,track,2).rotation,[6,30,0]);
});

test('switching a stage preserves its object IDs, timeline, and edits',async()=>{
  const {activeSequence,activateStage,blankStage,total}=await import('../src/previs/project.ts');
  const p=structuredClone(street);
  assert.equal(total(p),18);
  const first=structuredClone(activeSequence(p));
  activateStage(p,blankStage('Studio B'));
  assert.equal(p.shots.length,1);
  assert.equal(p.tracks.length,0);
  assert.equal(projectSchema.safeParse(p).success,true);
  activateStage(p,first);
  assert.equal(total(p),18);
  assert.equal(p.tracks[1].objectId,'car');
  assert.equal(p.stages?.[0].name,'Studio B');
});
