import { z } from 'zod';
import { assemblySchema, reportSchema } from "./scene/model";

export type V3 = [number, number, number];
const vec = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const dimension = z.number().finite().min(.01).max(1000);
const size = z.tuple([dimension, dimension, dimension]);
const id = z.string().regex(/^[\w-]{1,64}$/);
const time = z.number().finite().min(0).max(600);
const name = z.string().trim().min(1).max(100);
export const kinds = ['road','sidewalk','tree','lamp','building','character','car','box','sphere','table','chair','asset'] as const;
export const actions = ['hold','walk','jog','turn','sit','drive'] as const;
const angle = z.number().finite();
export const objectSchema = z.object({
  id, name, kind: z.enum(kinds), position: vec, size, rotation: vec.default([0,0,0]),
  scale: size.default([1,1,1]), color: z.string().regex(/^#[\da-f]{6}$/i).default('#6a7277'),
  visible: z.boolean().default(true), locked: z.boolean().default(false),
  group: z.string().max(80).default(''), assetId: id.optional(), identityId:id.optional(),
  model:assemblySchema.optional(), modelClip:name.optional(), role:z.string().max(160).optional(),
  source:z.enum(['exact','procedural','composed','proxy']).optional(),
});
export const interpolation=z.enum(['linear','ease','hold']);
export const keySchema = z.object({ time, position: vec, yaw: angle.optional(), rotation: vec.optional(), visible: z.boolean().optional(), interpolation:interpolation.optional() });
export const trackSchema = z.object({
  objectId: id, action: z.enum(actions), keys: z.array(keySchema).min(1).max(100), modelClip:name.optional(),
});
export const cameraSchema = z.object({
  id, name, position: vec, target: vec, fov: z.number().min(10).max(130), roll: angle.default(0),
  actorId: id.optional(), keys: z.array(z.object({ time, position: vec, target: vec, interpolation:interpolation.optional() })).max(100).default([]),
});
export const shotSchema = z.object({
  id, name, cameraId: id, start: time, duration: z.number().min(.1).max(30),
  prompt: z.string().max(4000).default(''),
});
export const stageSchema=z.object({ bounds:size, objects:z.array(objectSchema).max(150) });
const stageSequence=z.object({
  id,name,stage:stageSchema,tracks:z.array(trackSchema).max(100),
  cameras:z.array(cameraSchema).min(1).max(40),shots:z.array(shotSchema).min(1).max(40),
});
export const projectSchema = z.object({
  version: z.literal(3), id, title: name, script: z.string().max(18000), sceneReport:reportSchema.optional(),
  stage: stageSchema, stageId:id.optional(), stageName:name.optional(), stages:z.array(stageSequence).max(15).optional(),
  reusable:z.array(objectSchema).max(100).optional(),
  tracks: z.array(trackSchema).max(100), cameras: z.array(cameraSchema).min(1).max(40),
  shots: z.array(shotSchema).min(1).max(40), fps: z.number().int().min(12).max(60),
}).superRefine((p, ctx) => {
  function issue(message: string) { ctx.addIssue({ code:'custom', message }); }
  if(new Set([p.stageId??'active',...(p.stages??[]).map(s=>s.id)]).size!==1+(p.stages?.length??0))issue('Stage IDs must be unique.');
  const allShots=[...p.shots,...(p.stages??[]).flatMap(s=>s.shots)];
  if(new Set(allShots.map(s=>s.id)).size!==allShots.length)issue('Shot IDs must be unique across stages.');
  for(const sequence of [p,...(p.stages??[])]) {
  for (const items of [sequence.stage.objects, sequence.cameras, sequence.shots]) {
    if (new Set(items.map(o => o.id)).size !== items.length) issue('IDs must be unique within a collection.');
  }
  const objects = new Set(sequence.stage.objects.map(o => o.id));
  const cameras = new Set(sequence.cameras.map(c => c.id));
  if (new Set(sequence.tracks.map(t => t.objectId)).size !== sequence.tracks.length) issue('Each object can have one track.');
  if (sequence.tracks.some(t => !objects.has(t.objectId))) issue('A blocking track points to an unknown object.');
  if (sequence.cameras.some(c => c.actorId && !objects.has(c.actorId))) issue('A camera points to an unknown actor.');
  if (sequence.shots.some(s => !cameras.has(s.cameraId))) issue('A shot points to an unknown camera.');
  if (sequence.shots.some(s => s.start + s.duration > 600)) issue('Shot interval exceeds 600 seconds.');
  for (const set of [...sequence.tracks.map(t=>t.keys), ...sequence.cameras.map(c=>c.keys)]) {
    if (set.some((k, i) => i > 0 && set[i-1].time >= k.time)) issue('Keyframes must have increasing, unique times.');
  }
  }
});
export type Project = z.infer<typeof projectSchema>;
export type StageSequence=z.infer<typeof stageSequence>;
export type StageObject = z.infer<typeof objectSchema>;
export type Camera = z.infer<typeof cameraSchema>;
export type Shot = z.infer<typeof shotSchema>;
export type Track = z.infer<typeof trackSchema>;
export type Key = z.infer<typeof keySchema>;
export type View = 'stage' | 'blocking' | 'cameras';
export type Pass = 'clay' | 'depth' | 'normal' | 'pose';
export const passes: Pass[] = ['clay','depth','normal','pose'];
export const uid = () => crypto.randomUUID();
export const total = (p: Project) => p.shots.reduce((sum, shot) => sum + shot.duration, 0);
export const cutAt = (p: Project, index: number) => p.shots.slice(0, index).reduce((sum, shot) => sum + shot.duration, 0);
export const orderKeys = <T extends {time: number}>(keys: T[]) => [...keys].sort((a,b)=>a.time-b.time).filter((a,i,all)=>i===all.length-1||a.time!==all[i+1].time);
export const mix = (a: number, b: number, v: number) => a + (b - a) * v;
export const mix3 = (a: V3, b: V3, v: number) => a.map((n,i) => mix(n,b[i],v)) as V3;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function atCut(p: Project, position: number) {
  let cursor = 0;
  for (const [index, shot] of p.shots.entries()) {
    if (position < cursor + shot.duration || index === p.shots.length - 1) {
      const local = clamp(position - cursor,0,shot.duration);
      return { shot, index, local, time:shot.start + local, cut:cursor };
    }
    cursor += shot.duration;
  }
  throw new Error('Project requires a shot.');
}

function span<T extends {time:number;interpolation?:'linear'|'ease'|'hold'}>(keys: T[], t: number): [T,T,number] {
  const next = keys.findIndex(k => k.time > t);
  if (next === 0) return [keys[0],keys[0],0];
  if (next < 0) return [keys.at(-1)!,keys.at(-1)!,0];
  const a = keys[next-1], b = keys[next];
  const u=(t-a.time)/(b.time-a.time);
  return [a,b,a.interpolation==='hold'?0:a.interpolation==='ease'?u*u*(3-2*u):u];
}
export function objectState(o: StageObject, track: Track | undefined, t: number) {
  if (!track?.keys.length) return { position:o.position, yaw:o.rotation[1], rotation:o.rotation, active:false, visible:o.visible };
  const [a,b,v] = span(track.keys,t);
  const dx = b.position[0]-a.position[0], dz = b.position[2]-a.position[2];
  const moving = Math.hypot(dx,dz)>.0001;
  const previous = track.keys[Math.max(0,track.keys.indexOf(a)-1)];
  const lastX=a.position[0]-previous.position[0], lastZ=a.position[2]-previous.position[2];
  const facing = moving ? Math.atan2(dx,dz)*180/Math.PI : Math.hypot(lastX,lastZ)>.0001 ? Math.atan2(lastX,lastZ)*180/Math.PI : o.rotation[1];
  const start=a.rotation??[o.rotation[0],a.yaw??facing,o.rotation[2]];
  const end=b.rotation??[start[0],b.yaw??start[1],start[2]];
  const rotation=mix3(start,end,v);
  return {position:mix3(a.position,b.position,v),yaw:rotation[1],rotation,active:moving&&a.interpolation!=='hold',visible:o.visible&&(a.visible??true)};
}
export function cameraState(p: Project, shot: Shot, t: number) {
  const c = p.cameras.find(v=>v.id===shot.cameraId)!;
  let {position,target} = c;
  if (c.keys.length) {
    const [a,b,v] = span(c.keys,t);
    position=mix3(a.position,b.position,v);
    target=mix3(a.target,b.target,v);
  }
  if (c.actorId) {
    const obj=p.stage.objects.find(o=>o.id===c.actorId);
    if (obj) {
      const state=objectState(obj,p.tracks.find(v=>v.objectId===obj.id),t);
      const delta=state.position.map((n,i)=>n-obj.position[i]) as V3;
      position=position.map((n,i)=>n+delta[i]) as V3;
      target=target.map((n,i)=>n+delta[i]) as V3;
    }
  }
  return {...c,position,target};
}

export const makeObject = (kind: StageObject['kind'], label?: string) => objectSchema.parse({
  id:uid(), name:label || (kind[0].toUpperCase()+kind.slice(1)), kind, position:[0,0,0], size:[1,1,1],
});

export const streetScript = 'A jogger runs along a tree-lined street at dusk. Streetlights line the footpath. A sedan approaches from behind and passes a camera 0.15 metres above the road. Begin with a wide view, track beside the jogger, then cut to the frog-eye car pass and finish on a rear wide shot.';

function obj(id: string, name: string, kind: StageObject['kind'], position: V3, size: V3, color: string) {
  return objectSchema.parse({ id,name,kind,position,size,color });
}

const streetObjects = [
  obj('road','Main road','road',[0,-.14,0],[8,.14,64],'#323943'),
  obj('pavement','East footpath','sidewalk',[4.95,-.09,0],[1.9,.23,64],'#7a8085'),
  obj('westwalk','West footpath','sidewalk',[-4.95,-.09,0],[1.9,.23,64],'#727980'),
  obj('jogger','Jogger','character',[4.75,.14,-15],[.62,1.78,.48],'#f47e4f'),
  obj('car','Sedan','car',[1.75,0,-29],[1.88,1.45,4.35],'#628de2'),
  ...[-23,-12,0,11,22].flatMap((z,i)=>[
    obj('tree-e'+i,'East tree '+(i+1),'tree',[6.32,.02,z],[2.2,4.2,2.4],i%2?'#52786a':'#487361'),
    obj('tree-w'+i,'West tree '+(i+1),'tree',[-6.3,.02,z+3],[2.85,4.8,2.85],'#52796b'),
  ]),
  ...[-23,-8,8,23].flatMap((z,i)=>[
    obj('lamp-e'+i,'Streetlight '+(i+1),'lamp',[5.85,.14,z],[.66,4.3,.4],'#a5a1a0'),
    obj('lamp-w'+i,'West light '+(i+1),'lamp',[-5.85,.14,z+5],[.66,4,.4],'#8a9097'),
  ]),
  ...[-22,-10,3,16,26].flatMap((z,i)=>[
    obj('bld-e'+i,'East building '+(i+1),'building',[9.35,0,z],[3.6,4.4+(i%3)*1.8,8.6],'#697484'),
    obj('bld-w'+i,'West building '+(i+1),'building',[-9.6,0,z+1],[3.8,4.1+(i%4)*1.3,8.4],'#606b7a'),
  ]),
].map(o=>({...o,group: o.kind==='building'||o.kind==='tree'||o.kind==='lamp' ? 'Street context' : ''}));

export const street: Project = projectSchema.parse({
  version:3, id:'street-demo', title:'The Night Run', script:streetScript, fps:24,
  stage:{bounds:[25,12,64],objects:streetObjects},
  tracks:[
    {objectId:'jogger',action:'jog',keys:[{time:0,position:[4.75,.14,-15]},{time:5,position:[4.75,.14,-5]},{time:9,position:[4.75,.14,3]},{time:14,position:[4.75,.14,13]}]},
    {objectId:'car',action:'drive',keys:[{time:0,position:[1.75,0,-29]},{time:6,position:[1.75,0,-12]},{time:8.5,position:[1.75,0,3]},{time:10,position:[1.75,0,17]},{time:14,position:[1.75,0,31]}]},
  ],
  cameras:[
    {id:'wide',name:'Establishing',position:[-6,6,10],target:[2,.7,-9],fov:57},
    {id:'tracking',name:'Jogger tracking',position:[-.25,1.35,-10],target:[4.75,1.07,-15],fov:54,actorId:'jogger'},
    {id:'frog',name:'Frog-eye pass',position:[1.76,.15,3],target:[3,.67,-6],fov:69},
    {id:'rear',name:'Rear wide',position:[6.5,3.1,-1],target:[3,.9,14],fov:53},
    {id:'ending',name:'End hold',position:[8.2,2.3,4],target:[4.5,1.2,13],fov:49},
  ],
  shots:[
    {id:'s1',name:'Establishing',cameraId:'wide',start:0,duration:3,prompt:'Wide vertical view of a jogger on the east footpath at blue hour. An approaching sedan remains on the road.'},
    {id:'s2',name:'Jogger tracking',cameraId:'tracking',start:3,duration:3,prompt:'Track beside the jogger, keeping their stride and the roadside lamps in view.'},
    {id:'s3',name:'Frog-eye pass',cameraId:'frog',start:6,duration:4,prompt:'Fixed ground-level perspective. The sedan approaches along the road and passes above the camera; continue to reveal the jogger.'},
    {id:'s4',name:'Rear wide',cameraId:'rear',start:10,duration:4,prompt:'Wide rear view of the same jogger and sedan continuing along the road.'},
    {id:'s5',name:'New shot',cameraId:'ending',start:14,duration:4,prompt:'Hold the final wide composition on the same street with the jogger at the end of the path.'},
  ],
});

export const presets = ['Wide','Medium','Close-up','Over shoulder','First-person','Low angle','High angle','Tracking','Follow','Dolly','Orbit','Frog-eye'] as const;
export function presetCamera(preset: typeof presets[number], p: Project, shot: Shot): Partial<Camera> {
  const actor = p.stage.objects.find(o=>o.kind==='character');
  const point = actor ? objectState(actor,p.tracks.find(t=>t.objectId===actor.id),shot.start).position : [0,0,0] as V3;
  const linked = preset==='Tracking'||preset==='Follow'||preset==='First-person';
  const origin = linked && actor ? actor.position : point;
  const targets: Record<typeof presets[number], [number,number,number,number]> = {
    Wide:[-7,5,9,62], Medium:[-3,1.7,4,49], 'Close-up':[-.8,1.6,1.8,37],
    'Over shoulder':[-.85,1.63,-1.05,55], 'First-person':[0,1.61,.28,72],
    'Low angle':[-2,.42,3,54], 'High angle':[-3,5.1,3,52], Tracking:[-4,1.3,.2,55],
    Follow:[-.7,1.6,-4,56], Dolly:[-3,1.7,6,52], Orbit:[-5,2,4,52], 'Frog-eye':[-3,.15,4,70],
  };
  const [x,y,z,fov]=targets[preset];
  const position:V3=[origin[0]+x,preset==='Frog-eye'? .15:origin[1]+y,origin[2]+z];
  const target:V3=[origin[0],origin[1]+(preset==='Close-up'?1.55:1.05),origin[2]+(preset==='First-person'?8:0)];
  const stop:V3=preset==='Dolly'?[origin[0]-1,origin[1]+1.6,origin[2]+2]:[origin[0]+4,origin[1]+2,origin[2]+4];
  const animated=preset==='Dolly'||preset==='Orbit';
  return {position,target,fov,roll:0,actorId:linked?actor?.id:undefined,keys:animated?[{time:shot.start,position,target},{time:shot.start+shot.duration,position:stop,target}]:[]};
}

export function collision(p: Project, t: number) {
  const actors=p.stage.objects.filter(o=>o.visible && (o.kind==='car'||o.kind==='character'||p.tracks.some(v=>v.objectId===o.id)));
  for (const [i,a] of actors.entries()) {
    const av=objectState(a,p.tracks.find(v=>v.objectId===a.id),t);
    for (const b of p.stage.objects) {
      if (!b.visible||b.id===a.id||['road','sidewalk'].includes(b.kind)||actors.slice(0,i).includes(b)) continue;
      const bv=objectState(b,p.tracks.find(v=>v.objectId===b.id),t);
      if(!av.visible||!bv.visible)continue;
      const aSize=a.size.map((x,j)=>x*a.scale[j]), bSize=b.size.map((x,j)=>x*b.scale[j]);
      const radians=(y:number)=>y*Math.PI/180;
      const width=(s:number[], y:number)=>Math.abs(s[0]*Math.cos(radians(y)))+Math.abs(s[2]*Math.sin(radians(y)));
      const depth=(s:number[], y:number)=>Math.abs(s[2]*Math.cos(radians(y)))+Math.abs(s[0]*Math.sin(radians(y)));
      const distance=av.position.map((k,j)=>Math.abs(k-bv.position[j]));
      if (distance[0]<(width(aSize,av.yaw)+width(bSize,bv.yaw))*.45 &&
          distance[2]<(depth(aSize,av.yaw)+depth(bSize,bv.yaw))*.45 &&
          av.position[1]+aSize[1]>bv.position[1]&&bv.position[1]+bSize[1]>av.position[1]) return a.name+' overlaps '+b.name;
    }
  }
  return '';
}

export function activeSequence(p:Project):StageSequence{
  return {id:p.stageId??'active',name:p.stageName??'Urban road',stage:p.stage,tracks:p.tracks,cameras:p.cameras,shots:p.shots};
}
export function activateStage(p:Project,sequence:StageSequence) {
  const previous=activeSequence(p);
  if(previous.id===sequence.id)return;
  p.stages=[...(p.stages??[]).filter(s=>s.id!==sequence.id),previous];
  p.stageId=sequence.id;p.stageName=sequence.name;p.stage=sequence.stage;
  p.tracks=sequence.tracks;p.cameras=sequence.cameras;p.shots=sequence.shots;
}
export function blankStage(label:string):StageSequence{
  const cameraId=uid();
  return {id:uid(),name:label,stage:{bounds:[20,8,26],objects:[]},tracks:[],
    cameras:[{id:cameraId,name:'Establishing camera',position:[4,3,8],target:[0,1,0],fov:55,roll:0,keys:[]}],
    shots:[{id:uid(),name:'Establishing',cameraId,start:0,duration:4,prompt:''}]};
}
