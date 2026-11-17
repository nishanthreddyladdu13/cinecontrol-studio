import { projectSchema, type Project, type StageSequence, type V3 } from '../project';
import { getAsset, matchAsset } from './catalog';
import { generatorParameters, generateModel, type Generator } from './generators';
import { readScene, type ObjectInput, type SceneObject } from './input';
import { type Assembly, type Part, type SceneReport } from './model';
import { buildTracks } from './motion';
import { buildCameras } from './cameras';
import { buildSpatial, checkPlacement, resolvePlacement, type SpatialEntry } from './spatial';

const defaults:Record<Generator,{size:V3;color:string}>={
  building:{size:[9,12,8],color:'#788995'},room:{size:[8,3,6],color:'#8e9e9b'},
  deck:{size:[5,.24,3],color:'#aaaeb3'},tree:{size:[2.4,4.4,2.4],color:'#527558'},
  terrain:{size:[28,2,24],color:'#6e8258'},road:{size:[7,.14,30],color:'#474e56'},
  bench:{size:[1.8,.9,.64],color:'#b48a62'},lantern:{size:[.3,.48,.3],color:'#39444a'},
  crate:{size:[.8,.68,.7],color:'#a48d70'}
};
const builtinKinds=new Set(['sidewalk','car','lamp','table','chair']);
const semanticGenerators:Record<string,Generator>={building:'building',tower:'building',house:'building',room:'room',deck:'deck',balcony:'deck',tree:'tree',terrain:'terrain',road:'road',bench:'bench',lantern:'lantern',crate:'crate'};
const normalized=(s?:string)=>(s??'').toLowerCase().trim();
function geometry(parts:Part[],size:V3):Assembly{
  for(const part of parts){
    if(part.shape==='mesh'&&part.triangles.some(t=>new Set(t).size<3||t.some(i=>i>=part.vertices.length)))throw Error(part.name+' contains an invalid triangle index.');
    if(part.shape==='prism'){
      const p=part.profile;
      const area=p.reduce((sum,[x,y],i)=>{const [nx,ny]=p[(i+1)%p.length];return sum+x*ny-nx*y;},0);
      if(Math.abs(area)<.0001)throw Error(part.name+' requires a non-degenerate prism outline.');
    }
  }
  return {size,parts};
}

function resolveObject(spec:ObjectInput,quality:string,report:SceneReport,warn:(message:string)=>void):SpatialEntry{
  const category=normalized(spec.category);
  const asset=spec.assetId?getAsset(spec.assetId):(!spec.generator&&!spec.parts&&!spec.primitive?matchAsset(spec.category,spec.tags):undefined);
  if(spec.assetId&&!asset)warn(spec.name+' requested missing catalog asset '+spec.assetId+'. A local substitute is used.');
  const generator=spec.generator??(Object.hasOwn(semanticGenerators,category)?semanticGenerators[category]:undefined);
  if(spec.parameters){
    const unused=Object.keys(spec.parameters).filter(key=>!generator||!(generatorParameters[generator] as string[]).includes(key));
    if(unused.length)throw Error(spec.name+' uses unsupported generator parameters '+unused.join(', ')+'.');
  }
  const isHuman=spec.actor==='human'||category==='human';
  const inferredKind=builtinKinds.has(category)?category:spec.actor==='vehicle'?'car':isHuman?'character':undefined;
  const size:V3=spec.size??asset?.size??(generator?defaults[generator].size:undefined)??(isHuman?[.64,1.74,.52]:spec.actor==='vehicle'?[1.8,1.45,4.1]:[1,1,1]);
  const color=spec.color??(generator?defaults[generator].color:undefined)??'#798f9c';
  const primitive=spec.primitive;
  const o:SceneObject={id:spec.id,name:spec.name,kind:'box',position:[...(spec.position??[0,0,0])],rotation:[...(spec.rotation??[0,0,0])],
    size:[...size],scale:[1,1,1],visible:true,locked:false,color,group:spec.group??'',identityId:spec.identityId,role:spec.role};
  if(asset){
    o.assetId=asset.id;o.kind=asset.category==='human'||isHuman?'character':'asset';o.source='exact';
    o.rotation[1]+=asset.yaw;
    if(spec.clip&&asset.clips.includes(spec.clip))o.modelClip=spec.clip;
    else if(spec.clip)warn(spec.name+' clip '+spec.clip+' is unavailable on '+asset.name+'.');
  }else if(spec.generator||generator&&!spec.parts&&!primitive){
    o.model=generateModel(generator!,size,color,spec.parameters,quality);o.source='procedural';
    if(generator==='building'&&(spec.parameters?.floors??0)>(quality==='enhanced'?12:5))warn(spec.name+' uses simplified façade detail across the requested building height.');
  }else if(spec.parts){
    o.model=geometry(spec.parts,size);o.source='composed';
  }else if(primitive){
    o.model=geometry([{shape:primitive,name:spec.name,size,position:[0,size[1]/2,0]}],size);o.source='composed';
  }else if(inferredKind){
    o.kind=inferredKind as SceneObject['kind'];o.source=isHuman?'proxy':'procedural';
    if(isHuman)warn(spec.name+' uses the generic animated humanoid proxy.');
    if(spec.actor==='vehicle'&&category!=='car')warn(spec.name+' uses a sedan approximation.');
  }else{
    o.source='proxy';
    o.color=spec.color??'#ba8754';
    warn(spec.name+(spec.role?' ('+spec.role+')':'')+' uses a labeled blockout proxy. Replace it with a GLB or provide a parts assembly.');
  }
  if(spec.clip&&!asset)warn(spec.name+' clip '+spec.clip+' is unavailable for this model.');
  report[o.source==='proxy'?'proxies':o.source]++;
  const support=generator==='room'?Math.min(.2,size[0]*.12,size[2]*.12):size[1];
  const ground=spec.walkable??(generator==='room'||generator==='deck'||generator==='terrain'||generator==='road'||generator==='building'||(o.kind==='box'&&size[1]<.45));
  return {object:o,spec,support,ground};
}

export async function buildScene(value:unknown,progress?:(message:string)=>void){
  const input=readScene(value);
  const report:SceneReport={exact:0,procedural:0,composed:0,proxies:0,tracks:0,shots:0,warnings:[],assumptions:input.assumptions};
  const stages:StageSequence[]=[];
  const shotIds=new Set<string>();
  let totalParts=0;
  for(const stage of input.stages){
    if(stages.some(s=>s.id===stage.id))throw Error('Duplicate stage ID '+stage.id+'.');
    progress?.('Building '+stage.name+'…');
    await new Promise(resolve=>setTimeout(resolve,0));
    const warn=(message:string)=>{if(report.warnings.length<299)report.warnings.push((stage.name+' · '+message).slice(0,350));
      else if(report.warnings.length===299)report.warnings.push('Additional diagnostics omitted. Simplify the scene for a complete report.');};
    const entries=new Map<string,SpatialEntry>();
    for(const spec of stage.objects){
      if(entries.has(spec.id))throw Error(stage.name+' has duplicate object ID '+spec.id+'.');
      const entry=resolveObject(spec,input.quality??'enhanced',report,warn);
      totalParts+=entry.object.model?.parts.length??1;
      if(totalParts>5000)throw Error('This project exceeds 5,000 generated mesh parts. Reduce prefab detail or divide the project.');
      entries.set(spec.id,entry);
    }
    resolvePlacement(entries,warn);
    const objects=[...entries.values()].map(entry=>entry.object);
    const moving=new Set((stage.tracks??[]).map(track=>track.objectId));
    const spatial=buildSpatial(entries.values(),moving);
    try{
      checkPlacement(entries,spatial,warn);
      const tracks=await buildTracks(stage.tracks??[],entries,spatial,warn);
      const {cameras,shots}=buildCameras({...stage,look:stage.look??input.look},objects,tracks,spatial,warn);
      for(const shot of shots){
        if(shotIds.has(shot.id))throw Error('Duplicate shot ID '+shot.id+' across stages.');
        shotIds.add(shot.id);
      }
      report.tracks+=tracks.length;
      report.shots+=shots.length;
      stages.push({id:stage.id,name:stage.name,stage:{bounds:stage.bounds,objects},tracks,cameras,shots});
    }finally{spatial.dispose();}
  }
  const [active,...inactive]=stages;
  const project:Project=projectSchema.parse({version:3,id:input.id,title:input.title,script:input.script??'',fps:input.fps??24,
    stageId:active.id,stageName:active.name,stage:active.stage,tracks:active.tracks,cameras:active.cameras,shots:active.shots,
    stages:inactive,sceneReport:report});
  return project;
}
