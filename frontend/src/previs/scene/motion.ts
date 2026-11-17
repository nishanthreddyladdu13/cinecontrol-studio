import { Vector3 } from 'three';
import { getAsset } from './catalog';
import type { TrackInput } from './input';
import { rounded, waypoint, type Spatial, type SpatialEntry } from './spatial';
import type { Key, Track, V3 } from '../project';

type Warning=(message:string)=>void;
const vector=([x,y,z]:V3)=>new Vector3(x,y,z);
export async function buildTracks(inputs:TrackInput[],entries:Map<string,SpatialEntry>,spatial:Spatial,warn:Warning):Promise<Track[]>{
  const tracks:Track[]=[];
  const used=new Set<string>();
  for(const input of inputs){
    const entry=entries.get(input.objectId);
    if(!entry)throw Error('Blocking references missing object '+input.objectId+'.');
    const o=entry.object;
    if(used.has(o.id))throw Error('More than one blocking track for '+o.name+'.');
    used.add(o.id);
    const label=o.name+' blocking';
    let keys:Key[]=[];
    if(input.keys)keys=input.keys.map(({surface,...key})=>({...key,position:waypoint({position:key.position,surface},entries,warn,label)}));
    if(input.path){
      const path=input.path,start=path.start??0;
      let points=path.points.map(p=>waypoint(p,entries,warn,label));
      if(path.navigate){
        try{
          const {navMesh}=await import('./navigation');
          const nav=await navMesh(spatial,Math.max(.12,Math.min(o.size[0],o.size[2])*.48),Math.max(.5,o.size[1]*.94));
          try{
            const routed=nav?.route(points);
            if(routed)points=routed;
            else warn(label+' could not find a connected walkable route; authored waypoints kept.');
          }finally{nav?.dispose();}
        }catch{warn(label+' could not initialize navigation; authored waypoints kept.');}
      }
      const filtered=points.filter((p,i)=>!i||vector(p).distanceTo(vector(points[i-1]))>.0001);
      const cumulative:number[]=[0];
      for(let i=1;i<filtered.length;i++)cumulative.push(cumulative[i-1]+vector(filtered[i]).distanceTo(vector(filtered[i-1])));
      const length=cumulative.at(-1)??0;
      keys=filtered.map((point,i)=>({time:length?Number((start+path.duration*cumulative[i]/length).toFixed(6)):start,position:rounded(point)}));
      if(keys.length===1)warn(label+' has coincident waypoints; represented as a hold.');
    }
    if(input.physics){
      const {simulate}=await import('./physics');
      try{keys=await simulate(o,input.physics,spatial);}
      catch(error){throw Error(label+' physics could not be simulated: '+String(error));}
      if(spatial.proxies.some(proxy=>proxy.topOnly))warn(label+' uses static box contacts; terrain mesh has no Rapier collider.');
    }
    if(!keys.length||keys.some((key,i)=>key.time>600||(i>0&&key.time<=keys[i-1].time)))throw Error(label+' requires increasing key times in 0–600 seconds.');
    const size=o.size;
    if(!input.physics&&keys.some((k,i)=>{
      if(i>0&&keys[i-1].interpolation!=='hold'){
        const a=vector(keys[i-1].position).add(new Vector3(0,size[1]*.42,0));
        const b=vector(k.position).add(new Vector3(0,size[1]*.42,0));
        if(a.distanceToSquared(b)>.0001&&spatial.occludes(a,b,new Set([o.id])))return true;
      }
      return spatial.inside(vector(k.position).add(new Vector3(0,size[1]*.42,0)),new Set([o.id]));
    }))warn(label+' intersects static scenery. Edit the highlighted object’s path if this is unintended.');
    const asset=o.assetId?getAsset(o.assetId):undefined;
    const clip=input.clip??o.modelClip;
    if(clip&&asset&&!asset.clips.includes(clip))warn(o.name+' clip '+clip+' is unavailable; compatible default animation will be used if available.');
    if(clip&&!asset)warn(o.name+' clip '+clip+' is unavailable for this model.');
    if(['walk','jog','sit'].includes(input.action)&&asset&&!asset.actions[input.action]&&(!clip||!asset.clips.includes(clip)))warn(o.name+' has no matching skeletal animation for '+input.action+'; transform motion is preserved.');
    tracks.push({objectId:o.id,action:input.action,keys,...(clip&&asset?.clips.includes(clip)?{modelClip:clip}:{})});
  }
  return tracks;
}
