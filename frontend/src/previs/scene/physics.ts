import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import type { Key, StageObject, V3 } from '../project';
import type { TrackInput } from './input';
import { rounded, type Spatial } from './spatial';

let init:Promise<void>|undefined;
export async function simulate(object:StageObject, settings:NonNullable<TrackInput['physics']>, spatial:Spatial):Promise<Key[]>{
  await (init??=RAPIER.init());
  const world=new RAPIER.World({x:0,y:settings.gravity??-9.81,z:0});
  try{
    world.timestep=1/60;
    for(const {box,topOnly} of spatial.proxies){
      if(topOnly)continue;
      const center=box.getCenter(new Vector3()),half=box.getSize(new Vector3()).multiplyScalar(.5);
      world.createCollider(RAPIER.ColliderDesc.cuboid(half.x,half.y,half.z).setTranslation(center.x,center.y,center.z));
    }
    const [w,h,d]=object.size.map((size,i)=>size*object.scale[i]) as V3;
    const [x,y,z]=object.position,v=settings.velocity??[0,0,0],start=settings.start??0;
    const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x,y+h/2,z).setLinvel(...v).setCcdEnabled(true).lockRotations());
    const collider=object.model?.parts[0]?.shape==='sphere'&&Math.abs(w-h)<.01&&Math.abs(h-d)<.01
      ?RAPIER.ColliderDesc.ball(h/2):RAPIER.ColliderDesc.cuboid(w/2,h/2,d/2);
    world.createCollider(collider.setRestitution(settings.restitution??.22).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max),body);
    const keys:Key[]=start>0?[{time:0,position:[...object.position],interpolation:'hold'}]:[];
    const steps=Math.ceil(settings.duration*60),sample=Math.max(3,Math.ceil(steps/96));
    const save=(index:number)=>{
      const p=body.translation();
      keys.push({time:Number((start+Math.min(settings.duration,index/60)).toFixed(6)),position:rounded([p.x,p.y-h/2,p.z])});
    };
    save(0);
    for(let step=1;step<=steps;step++){
      world.step();
      if(step%sample===0||step===steps)save(step);
    }
    return keys;
  }finally{world.free();}
}
