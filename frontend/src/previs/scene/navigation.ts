import { init, NavMeshQuery } from '@recast-navigation/core';
import { generateSoloNavMesh } from '@recast-navigation/generators';
import { Vector3 } from 'three';
import type { Spatial } from './spatial';
import type { V3 } from '../project';

type Vector={x:number;y:number;z:number};
const toVector=([x,y,z]:V3)=>({x,y,z});
const fromVector=({x,y,z}:Vector):V3=>[x,y,z];
const distance=(a:V3,b:V3)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);

export async function navMesh(spatial:Spatial,radius:number,height:number){
  if(!spatial.proxies.some(proxy=>proxy.entry.ground))return;
  await init();
  const positions:number[]=[],indices:number[]=[];
  const point=new Vector3();
  let extent=0;
  for(const {mesh,box} of spatial.proxies) {
    const {geometry}=mesh;
    const vertex=geometry.getAttribute('position'),index=geometry.index,offset=positions.length/3;
    for(let j=0;j<vertex.count;j++) {
      point.fromBufferAttribute(vertex,j).applyMatrix4(mesh.matrixWorld);
      positions.push(point.x,point.y,point.z);
    }
    for(let j=0;j<(index?.count??vertex.count);j++)indices.push(offset+(index?.getX(j)??j));
    extent=Math.max(extent,Math.abs(box.min.x),Math.abs(box.min.z),Math.abs(box.max.x),Math.abs(box.max.z));
  }
  const cs=Math.max(.14,extent/200),ch=Math.max(.055,cs*.35);
  const result=generateSoloNavMesh(positions,indices,{cs,ch,walkableRadius:Math.ceil(radius/cs),walkableHeight:Math.ceil(height/ch),
    walkableClimb:Math.max(1,Math.floor(.23/ch)),minRegionArea:2,mergeRegionArea:4,maxEdgeLen:25});
  if(!result.success)return;
  const query=new NavMeshQuery(result.navMesh);
  return {
    route(points:V3[]){
      const path:V3[]=[];
      for(let i=1;i<points.length;i++){
        const end=points[i],start=points[i-1];
        const result=query.computePath(toVector(start),toVector(end),{halfExtents:{x:.6,y:.85,z:.6},maxStraightPathPoints:48});
        const segment=result.path.map(fromVector);
        if(!result.success||segment.length<2||distance(segment[0],start)>Math.max(.45,cs*2)||distance(segment.at(-1)!,end)>Math.max(.45,cs*2))return;
        path.push(...segment.slice(i===1?0:1));
        if(path.length>100)return;
      }
      return path;
    },
    dispose(){query.destroy();result.navMesh.destroy();}
  };
}
