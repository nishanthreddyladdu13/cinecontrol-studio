import * as T from 'three';
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';
import { partGeometry } from './render-model';
import type { ObjectInput, SceneObject, Waypoint } from './input';
import type { V3 } from '../project';

const vector=(v:V3)=>new T.Vector3(...v);
export const array=(v:T.Vector3):V3=>[v.x,v.y,v.z];
const radians=(value:number)=>T.MathUtils.degToRad(value);
const orientation=(o:SceneObject)=>new T.Quaternion().setFromEuler(new T.Euler(...o.rotation.map(radians) as V3));
const nominal=(o:SceneObject)=>o.size.map((n,i)=>n*o.scale[i]) as V3;
export function localToWorld(o:SceneObject,p:V3):V3 {
  return array(vector(p).applyQuaternion(orientation(o)).add(vector(o.position)));
}
export function objectBounds(o:SceneObject){
  const [w,h,d]=nominal(o);
  return new T.Box3(new T.Vector3(-w/2,0,-d/2),new T.Vector3(w/2,h,d/2))
    .applyMatrix4(new T.Matrix4().compose(vector(o.position),orientation(o),new T.Vector3(1,1,1)));
}

type Entry={object:SceneObject;spec:ObjectInput;support:number;ground:boolean};
export const rounded=(v:V3):V3=>v.map(x=>Number(x.toFixed(5))) as V3;

function surfaceAt(entry:Entry,x:number,z:number):number|undefined {
  const {object,spec,support}=entry;
  const [w,h,d]=nominal(object);
  const worldTop=objectBounds(object).max.y;
  const worldRay=new T.Ray(new T.Vector3(x,worldTop+2,z),new T.Vector3(0,-1,0));
  const inverse=orientation(object).invert();
  const origin=worldRay.origin.clone().sub(vector(object.position)).applyQuaternion(inverse);
  const direction=worldRay.direction.clone().applyQuaternion(inverse);
  const ray=new T.Ray(origin,direction);
  const terrain=spec.generator==='terrain'?object.model?.parts.find(p=>p.shape==='mesh'):undefined;
  if(terrain){
    for(const triangle of terrain.triangles){
      const [a,b,c]=triangle.map(i=>vector(terrain.vertices[i]).multiply(vector(terrain.size)).add(vector(terrain.position)));
      const hit=ray.intersectTriangle(a,b,c,false,new T.Vector3());
      if(hit)return localToWorld(object,array(hit))[1];
    }
    return;
  }
  if(Math.abs(direction.y)<1e-6)return;
  const along=(support-origin.y)/direction.y;
  if(along<0)return;
  const hit=ray.at(along,new T.Vector3());
  if(Math.abs(hit.x)>w/2+.005||Math.abs(hit.z)>d/2+.005||support>h+.01)return;
  return localToWorld(object,array(hit))[1];
}

export function waypoint(w:Waypoint,byId:Map<string,Entry>,warn:(message:string)=>void,label:string):V3 {
  if(!w.surface)return [...w.position];
  const entry=byId.get(w.surface);
  if(!entry)throw Error(label+' references unknown surface '+w.surface+'.');
  const [x,y,z]=w.position;
  const support=surfaceAt(entry,x,z);
  if(support===undefined){warn(label+' falls outside surface '+entry.object.name+'; original height kept.');return [...w.position];}
  return rounded([x,support+y,z]);
}

export function resolvePlacement(entries:Map<string,Entry>,warn:(message:string)=>void){
  const resolved=new Set<string>(),stack=new Set<string>();
  function visit(id:string){
    if(resolved.has(id))return entries.get(id)!;
    if(stack.has(id))throw Error('Circular placement dependency at '+id+'.');
    const entry=entries.get(id);
    if(!entry)throw Error('Unknown placement object '+id+'.');
    const {object,spec}=entry,p=spec.place;
    stack.add(id);
    if(p){
      const target=visit(p.target);
      const [w,h,d]=nominal(object),[tw,th,td]=nominal(target.object);
      const o=p.offset??[0,0,0],g=p.gap??.25;
      let relative:V3=[...o];
      if(p.relation==='between'){
        if(!p.other)throw Error(object.name+' requires a second target for between.');
        const a=target.object.position,b=visit(p.other).object.position;
        object.position=rounded(a.map((v,i)=>(v+b[i])/2+o[i]) as V3);
      }else{
        switch(p.relation){
          case 'on':relative=[o[0],target.support+o[1],o[2]];break;
          case 'above':relative=[o[0],th+g+o[1],o[2]];break;
          case 'below':relative=[o[0],-h-g+o[1],o[2]];break;
          case 'inside':relative=[o[0],target.spec.generator==='room'?target.support+o[1]:o[1],o[2]];break;
          case 'front':relative=[o[0],o[1],(td+d)/2+g+o[2]];break;
          case 'behind':relative=[o[0],o[1],-(td+d)/2-g+o[2]];break;
          case 'near':
          case 'beside':
          case 'along': {
            const side=p.side??'right';
            relative=side==='left'||side==='right'
              ?[(side==='left'?-1:1)*((tw+w)/2+g)+o[0],o[1],o[2]]
              :[o[0],o[1],(side==='back'?-1:1)*((td+d)/2+g)+o[2]];
            break;
          }
        }
        object.position=rounded(localToWorld(target.object,relative));
        if(p.relation==='on'){
          const [x,,z]=object.position;
          const support=surfaceAt(target,x,z);
          if(support===undefined)warn(object.name+' is outside the support footprint of '+target.object.name+'.');
          else object.position=rounded([x,support+o[1],z]);
        }
        if(p.relation==='inside'&&(Math.abs(relative[0])+w/2>tw/2||Math.abs(relative[2])+d/2>td/2||relative[1]+h>th))warn(object.name+' may extend outside '+target.object.name+'.');
        if(p.relation==='attached')warn(object.name+' attachment sets the starting transform only. Use keyframes if the parent moves.');
      }
    }
    stack.delete(id);resolved.add(id);return entry;
  }
  for(const id of entries.keys())visit(id);
  for(const {object,spec} of entries.values()){
    if(!spec.facing)continue;
    const target=entries.get(spec.facing);
    if(!target||target.object===object)throw Error(object.name+' has an invalid facing target '+spec.facing+'.');
    const [x,,z]=object.position,[tx,,tz]=target.object.position;
    if(Math.hypot(tx-x,tz-z)>.0001)object.rotation[1]=T.MathUtils.radToDeg(Math.atan2(tx-x,tz-z));
  }
}

export type SpatialEntry=Entry;
export function buildSpatial(entries:Iterable<Entry>,moving:Set<string>){
  const solids=[...entries].filter(entry=>entry.spec.solid!==false&&!moving.has(entry.object.id)&&!entry.spec.actor);
  const material=new T.MeshBasicMaterial({side:T.DoubleSide});
  const proxies: {entry:Entry;mesh:T.Mesh;box:T.Box3;topOnly:boolean}[]=[];
  for(const entry of solids){
    const o=entry.object;
    const model=o.model;
    const parts=model?.parts.filter(p=>entry.spec.generator!=='building'||p.name==='Main structure'||p.name==='Pitched roof'||p.name==='Roof parapet');
    for(const part of parts??[{shape:'box' as const,name:o.name,position:[0,o.size[1]/2,0] as V3,size:o.size}]){
      const g=partGeometry(part);
      if(part.shape==='mesh'){g.boundsTree=new MeshBVH(g,{targetLeafSize:8});}
      const mesh=new T.Mesh(g,material);
      if(g.boundsTree)mesh.raycast=acceleratedRaycast;
      const ratio=model?o.size.map((n,i)=>n/model.size[i]*o.scale[i]) as V3:o.scale;
      const local=new T.Matrix4().compose(vector(part.position),new T.Quaternion().setFromEuler(new T.Euler(...((('rotation' in part?part.rotation:undefined)??[0,0,0]).map(radians) as V3))),vector(part.size));
      mesh.matrixAutoUpdate=false;
      mesh.matrix.compose(vector(o.position),orientation(o),vector(ratio)).multiply(local);
      mesh.updateMatrixWorld(true);
      const box=new T.Box3().setFromObject(mesh);
      proxies.push({entry,mesh,box,topOnly:entry.spec.generator==='terrain'});
    }
  }
  const ray=new T.Raycaster();
  return {proxies,
    occludes(from:T.Vector3,to:T.Vector3,skip:Set<string>){
      const d=to.clone().sub(from);
      ray.set(from,d.clone().normalize());ray.far=Math.max(.01,d.length()-.07);ray.near=.035;
      return proxies.some(({entry,mesh,box})=>!skip.has(entry.object.id)&&ray.ray.intersectsBox(box)&&ray.intersectObject(mesh,false).length>0);
    },
    inside(point:T.Vector3,skip:Set<string>){
      return proxies.some(({entry,box,topOnly})=>!topOnly&&!skip.has(entry.object.id)&&box.containsPoint(point));
    },
    dispose(){
      for(const {mesh} of proxies){mesh.geometry.boundsTree=undefined;mesh.geometry.dispose();}
      material.dispose();
    }
  };
}
export type Spatial=ReturnType<typeof buildSpatial>;

export function checkPlacement(entries:Map<string,Entry>,spatial:Spatial,warn:(message:string)=>void){
  for(const entry of entries.values()){
    const {object,spec}=entry,[x,y,z]=object.position;
    if(!spec.actor||spec.actor==='creature'||spec.solid===false)continue;
    const supports=[...entries.values()].filter(other=>other.ground&&other!==entry);
    if(y<-.18||y>.18&&!supports.some(surface=>Math.abs((surfaceAt(surface,x,z)??Infinity)-y)<.16))
      warn(object.name+' starts away from a marked or inferred support surface.');
    const center=vector([x,y+object.size[1]*.4,z]);
    if(spatial.inside(center,new Set([object.id])))warn(object.name+' starts inside solid geometry.');
  }
}
