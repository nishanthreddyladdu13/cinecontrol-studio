import { Box3, Frustum, Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { objectState, type Camera, type Shot, type StageObject, type Track, type V3 } from '../project';
import type { Preset, ShotInput, StageInput } from './input';
import { array, objectBounds, rounded, type Spatial } from './spatial';

const vector=(v:V3)=>new Vector3(...v);
const positions:Record<Preset,[height:number,distance:number,angle:number,fov:number]>={
  establishing:[.46,1.25,45,59],wide:[.27,1.06,40,56],medium:[.13,.94,32,47],
  close:[.05,.77,24,39],'over-shoulder':[.12,.84,157,49],tracking:[.13,1.02,88,49],
  follow:[.19,1.05,170,53],orbit:[.24,1.12,63,52],dolly:[.14,1.17,37,48],
  low:[-.33,1.05,38,58],high:[.9,1.1,42,60],'first-person':[0,1,0,69],attached:[.05,1,0,62],
};
const cameraView=new PerspectiveCamera(55,9/16,.04,95);
const viewProjection=new Matrix4(),frustum=new Frustum();
function visible(camera:Vector3,target:Vector3,fov:number,subjects:Box3[],spatial:Spatial,skip:Set<string>){
  if(camera.distanceToSquared(target)<.001||spatial.inside(camera,skip))return -10;
  cameraView.position.copy(camera);cameraView.fov=fov;cameraView.lookAt(target);
  cameraView.updateProjectionMatrix();cameraView.updateMatrixWorld();
  frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(cameraView.projectionMatrix,cameraView.matrixWorldInverse));
  return subjects.reduce((score,box)=>{
    const center=box.getCenter(new Vector3()),half=box.getSize(new Vector3()).multiplyScalar(.34);
    if(!frustum.intersectsBox(box)||spatial.occludes(camera,center,skip))return score-1;
    const inFrame=[new Vector3(0,half.y,0),new Vector3(0,-half.y,0),new Vector3(half.x,0,half.z),new Vector3(-half.x,0,-half.z)]
      .filter(point=>frustum.containsPoint(point.add(center))).length;
    return score+1+inFrame/4;
  },0);
}

function shotInputs(stage:StageInput,tracks:Track[],count:number):ShotInput[]{
  if(stage.shots?.length)return stage.shots;
  const duration=Math.max(4,stage.duration??0,...tracks.flatMap(track=>track.keys.at(-1)?.time??0));
  const segments=Math.max(Math.ceil(duration/30),count&&duration>=5?2:1);
  return Array.from({length:segments},(_,index)=>({id:(stage.id.slice(0,51)+'-shot-'+(index+1)),
    name:index?'Action '+index:'Establishing',duration:duration/segments,preset:index?'tracking':'establishing'}));
}

export function buildCameras(stage:StageInput,objects:StageObject[],tracks:Track[],spatial:Spatial,warn:(message:string)=>void){
  const actors=objects.filter(o=>['character','car'].includes(o.kind)||tracks.some(track=>track.objectId===o.id));
  const get=(id:string)=>{const found=objects.find(o=>o.id===id);if(!found)throw Error('Camera references unknown object '+id+'.');return found;};
  const boundsAt=(o:StageObject,time:number)=>{
    const state=objectState(o,tracks.find(t=>t.objectId===o.id),time);
    return objectBounds({...o,position:state.position,rotation:state.rotation});
  };
  const stateAt=(o:StageObject,time:number)=>objectState(o,tracks.find(t=>t.objectId===o.id),time);
  const cameras:Camera[]=[],shots:Shot[]=[];
  let cursor=0;
  for(const spec of shotInputs(stage,tracks,actors.length)){
    const start=spec.start??cursor,end=start+spec.duration;
    if(end>600.000001)throw Error(spec.name+' exceeds the 600-second stage limit.');
    cursor=end;
    const preset=spec.preset??'wide';
    const candidates=objects.filter(o=>!o.locked&&o.size[0]<stage.bounds[0]*.89&&o.size[2]<stage.bounds[2]*.89);
    const fallback=candidates.length?candidates:objects;
    let subjects=spec.subjects?.map(get)??(actors.length?actors.slice(0,preset==='establishing'||preset==='wide'?4:1):fallback.slice(0,6));
    const attach=spec.attachTo?get(spec.attachTo):
      ['tracking','follow','first-person','attached'].includes(preset)?subjects[0]:undefined;
    if(preset==='first-person')subjects=subjects.filter(o=>o!==attach);
    const boxes=subjects.map(o=>boundsAt(o,start));
    const group=boxes.length?boxes.reduce((box,next)=>box.union(next),new Box3()):attach?boundsAt(attach,start):new Box3(new Vector3(-1,0,-1),new Vector3(1,1,1));
    if(preset==='establishing')for(const o of fallback.slice(0,12)){
      const box=boundsAt(o,start);
      if(box.getCenter(new Vector3()).distanceTo(group.getCenter(new Vector3()))<Math.min(12,stage.bounds[2]*.4))group.union(box);
    }
    const center=group.getCenter(new Vector3()),size=group.getSize(new Vector3());
    const skip=new Set(subjects.map(o=>o.id));
    if(attach)skip.add(attach.id);
    const [rise,factor,angle,defaultFov]=positions[preset],fov=spec.fov??defaultFov;
    const tan=Math.tan(fov*Math.PI/360), radius=Math.max(.7,Math.hypot(size.x,size.z)/2+.12,size.y*.5);
    const distance=Math.min(76,Math.max(1.1,radius/(tan*9/16)*factor));
    const subject=(attach??subjects[0]),yaw=subject?stateAt(subject,start).yaw:0;
    const target=spec.target?vector(spec.target):center.clone();
    const offset=(angle:number,dist=distance)=>{
      const rad=(yaw+angle)*Math.PI/180;
      return new Vector3(Math.sin(rad)*dist,Math.max(.12,center.y+radius*rise)-center.y,Math.cos(rad)*dist);
    };
    let position=spec.position?vector(spec.position):target.clone().add(offset(angle));
    if((preset==='first-person'||preset==='attached')&&attach&&!spec.position){
      const a=stateAt(attach,start),look=new Vector3(Math.sin(a.yaw*Math.PI/180),0,Math.cos(a.yaw*Math.PI/180));
      position=vector(a.position).add(new Vector3(0,attach.size[1]*(preset==='first-person'?.91:.8),0)).addScaledVector(look,attach.size[2]*.46);
      if(!spec.target&&!subjects.length)target.copy(position).addScaledVector(look,8);
    }else if(!spec.position&&!spec.keys){
      let score=-Infinity;
      for(const direction of [angle,-angle,angle+75,angle-75,angle+150,angle-150]){
        const proposed=target.clone().add(offset(direction));
        const n=visible(proposed,target,fov,boxes,spatial,skip);
        if(n>score){position=proposed;score=n;}
        if(n>=boxes.length*2)break;
      }
    }
    const keys=[...(spec.keys??[])];
    if(keys.some((key,i)=>i>0&&key.time<=keys[i-1].time))throw Error(spec.name+' requires increasing camera key times.');
    if(!keys.length&&!spec.position&&(preset==='orbit'||preset==='dolly')){
      const stop=preset==='dolly'?target.clone().lerp(position,.66):target.clone().add(offset(-angle));
      keys.push({time:start,position:rounded(array(position)),target:rounded(array(target)),interpolation:'ease'},
        {time:end,position:rounded(array(stop)),target:rounded(array(target))});
    }
    const initialPosition=attach?vector(stateAt(attach,start).position):new Vector3();
    const baseOffset=attach?initialPosition.sub(vector(attach.position)):new Vector3();
    const camera:Camera={id:'cam-'+String(cameras.length+1),name:spec.name,position:rounded(array(position.clone().sub(baseOffset))),
      target:rounded(array(target.clone().sub(baseOffset))),roll:spec.roll??0,fov,actorId:attach?.id,keys:keys.map(k=>({...k,
        position:rounded(array(vector(k.position).sub(baseOffset))),target:rounded(array(vector(k.target).sub(baseOffset)))}))};
    const samples=[start,(start+end)/2,end];
    if(boxes.length&&samples.some(t=>{
      const motion=attach?vector(stateAt(attach,t).position).sub(vector(stateAt(attach,start).position)):new Vector3();
      const keyIndex=keys.findIndex(k=>k.time>=t);
      const a=keyIndex<=0?keys[keyIndex===0?0:keys.length-1]:keys[keyIndex-1],b=keyIndex<=0?a:keys[keyIndex];
      const u=!a||a===b||a.interpolation==='hold'?0:(t-a.time)/(b.time-a.time);
      const at=a?vector(a.position).lerp(vector(b.position),u):position.clone();
      const toward=a?vector(a.target).lerp(vector(b.target),u):target.clone();
      return visible(at.add(motion),toward.add(motion),fov,subjects.map(o=>boundsAt(o,t)),spatial,skip)<subjects.length;
    }))warn(spec.name+' may crop a subject or lose visibility during the shot. Review in Camera View.');
    else if(!boxes.length&&spatial.inside(position,skip))warn(spec.name+' camera starts inside static geometry.');
    cameras.push(camera);
    shots.push({id:spec.id,name:spec.name,cameraId:camera.id,start,duration:spec.duration,prompt:spec.prompt??stage.look??''});
  }
  return {cameras,shots};
}
