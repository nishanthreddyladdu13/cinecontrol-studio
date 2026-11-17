import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Vector3 } from 'three';
import { buildScene } from '../src/previs/scene/orchestrator';
import { renderAssembly } from '../src/previs/scene/render-model';
import { activateStage, objectState, projectSchema, street } from '../src/previs/project';
import { importProject } from '../src/previs/legacy';
import { libraryAssets } from '../src/previs/scene/catalog';

const root=new URL('../public/',import.meta.url);
const folder=new URL('scene-kit/examples/',root);
const sample=(file:string)=>JSON.parse(readFileSync(new URL(file+'.json',folder),'utf8'));
const meshBounds=(parts:Parameters<typeof renderAssembly>[0])=>new Box3().setFromObject(renderAssembly(parts,parts.size,'#678abc'));

test('all scene kit examples compile to independently editable CineControl projects',async()=>{
  for(const file of readdirSync(folder)){
    const p=await buildScene(sample(file.replace('.json','')));
    assert.equal(JSON.stringify(projectSchema.parse(JSON.parse(JSON.stringify(p)))),JSON.stringify(p),file);
    assert.equal(p.sceneReport!.exact+p.sceneReport!.procedural+p.sceneReport!.composed+p.sceneReport!.proxies,
      p.stage.objects.length+(p.stages??[]).reduce((sum,stage)=>sum+stage.stage.objects.length,0),file);
  }
  assert.deepEqual(importProject(JSON.parse(JSON.stringify(street))),street);
});

test('rooftop support, asset geometry, editor data, and stage switches survive a save round-trip',async()=>{
  const p=await buildScene(sample('observatory'));
  const tower=p.stage.objects.find(o=>o.id==='tower')!;
  const engineer=p.stage.objects.find(o=>o.id==='engineer')!;
  assert.ok(tower.model!.parts.some(p=>p.name==='Roof parapet'));
  assert.ok(meshBounds(tower.model!).max.y>9);
  assert.deepEqual(engineer.position,[-2,9,0]);
  assert.ok(p.tracks[0].keys.every(key=>key.position[1]===9));
  const array=p.stage.objects.find(o=>o.id==='array')!;
  array.position=[1.7,9,-1.85];
  p.tracks[0].keys[1].position[0]=1.45;
  p.cameras[0].position[0]=14;
  activateStage(p,p.stages![0]);
  const reopened=importProject(JSON.parse(JSON.stringify(p)));
  activateStage(reopened,reopened.stages![0]);
  assert.deepEqual(reopened.stage.objects.find(o=>o.id==='array')!.position,array.position);
  assert.equal(reopened.tracks[0].keys[1].position[0],1.45);
  assert.equal(reopened.cameras[0].position[0],14);
});

test('Recast emits a routed editable track around a wall',async()=>{
  const p=await buildScene(sample('courtyard'));
  const track=p.tracks[0],walker=p.stage.objects.find(o=>o.id==='walker')!;
  assert.ok(track.keys.length>2);
  assert.ok(track.keys.some(k=>Math.abs(k.position[2])>2.5));
  for(let t=0;t<7;t+=.1){
    const [x,,z]=objectState(walker,track,t).position;
    assert.ok(Math.abs(x)>1.48||Math.abs(z)>2.48);
  }
  assert.equal(track.keys.at(-1)!.time,7);
});

test('Rapier bakes a repeatable sphere drop, bounce and static contact',async()=>{
  const p=await buildScene(sample('sluice'));
  const a=p.tracks.find(t=>t.objectId==='pellet')!.keys;
  assert.deepEqual(a,(await buildScene(sample('sluice'))).tracks.find(t=>t.objectId==='pellet')!.keys);
  assert.equal(a[0].interpolation,'hold');
  assert.ok(a.length<101);
  assert.ok(a.some(k=>Math.abs(k.position[1]-.36)<.06));
  const contact=a.findIndex(k=>k.position[1]<.44);
  assert.ok(contact>0&&a.slice(contact).some(k=>k.position[1]>.65));
  assert.ok(a.every(k=>k.position[1]>.30));
});

test('fictional object fallback preserves ID and role while composition retains detailed parts',async()=>{
  const p=await buildScene(sample('sluice'));
  const proxy=p.stage.objects.find(o=>o.id==='indicator')!;
  assert.equal(proxy.source,'proxy');
  assert.ok(proxy.role?.includes('fictional'));
  assert.equal(p.sceneReport?.proxies,1);
  assert.ok(p.sceneReport?.warnings.some(w=>w.includes('missing catalog asset')));
  const model=p.stage.objects.find(o=>o.id==='struts')!.model!;
  assert.equal(model.parts.length,4);
  const bounds=meshBounds(model);
  assert.ok(bounds.getSize(new Vector3()).x>=5);
});

test('catalog GLBs have offline files, attribution and declared animation clips',()=>{
  for(const asset of libraryAssets){
    const bytes=readFileSync(new URL(asset.path,root));
    assert.equal(bytes.toString('ascii',0,4),'glTF');
    const gltf=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
    assert.deepEqual(gltf.animations?.map((a:{name?:string},i:number)=>a.name??'animation_'+i)??[],asset.clips);
    assert.equal(gltf.buffers[0].uri,undefined);
    assert.ok(readFileSync(new URL(asset.licenseFile,root),'utf8').includes(asset.license.split(' AND ')[0]));
    assert.ok(asset.credit);
  }
});

test('unknown instructions, invalid meshes and cyclic placement are rejected',async()=>{
  const invalid=sample('sluice');
  invalid.stages[0].objects[0].execute='anything';
  await assert.rejects(()=>buildScene(invalid),/additional properties.*execute/);
  delete invalid.stages[0].objects[0].execute;
  invalid.stages[0].objects[0].place={relation:'on',target:'indicator'};
  await assert.rejects(()=>buildScene(invalid),/Circular placement/);
  delete invalid.stages[0].objects[0].place;
  invalid.stages[0].objects[1].parts.push({shape:'mesh',name:'Bad index',vertices:[[0,0,0],[.2,0,0],[0,.2,0]],triangles:[[0,1,200]],position:[0,0,0],size:[1,1,1]});
  await assert.rejects(()=>buildScene(invalid),/invalid triangle/);
});

test('a shotless unfamiliar scenario receives editable cameras and duration',async()=>{
  const p=await buildScene({sceneFormat:'cinecontrol.scene/1',id:'minimal',title:'Minimal',stages:[{
    id:'aqueduct',name:'Aqueduct',bounds:[10,8,12],duration:7,objects:[{id:'pipe',name:'Pipe',size:[1,1,6],primitive:'cylinder'}]
  }]});
  assert.equal(p.shots[0].duration,7);
  assert.ok(p.cameras[0].position.some(x=>x!==0));
});
