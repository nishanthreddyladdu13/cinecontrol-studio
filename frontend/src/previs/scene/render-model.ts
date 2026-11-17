import * as T from 'three';
import type { Assembly, Part } from './model';

export function partGeometry(part:Part) {
  switch (part.shape) {
    case 'box': return new T.BoxGeometry();
    case 'sphere': return new T.SphereGeometry(.5,18,12);
    case 'cone': return new T.ConeGeometry(.5,1,16);
    case 'cylinder': return new T.CylinderGeometry(.5,.5,1,18);
    case 'capsule': return new T.CapsuleGeometry(.25,.5,6,12).scale(2,1,2);
    case 'torus': return new T.TorusGeometry(.39,.11,8,28);
    case 'prism': {
      const profile=new T.Shape(part.profile.map(([x,y])=>new T.Vector2(x,y)));
      return new T.ExtrudeGeometry(profile,{depth:1,bevelEnabled:false,steps:1}).translate(0,0,-.5);
    }
    case 'mesh': {
      const geometry=new T.BufferGeometry();
      geometry.setAttribute('position',new T.Float32BufferAttribute(part.vertices.flat(),3));
      geometry.setIndex(part.triangles.flat());
      geometry.computeVertexNormals();
      return geometry;
    }
  }
}

export function renderAssembly(model:Assembly, size:number[], color:string) {
  const group=new T.Group();
  const materials=new Map<string,T.MeshStandardMaterial>();
  group.scale.set(size[0]/model.size[0],size[1]/model.size[1],size[2]/model.size[2]);
  for(const part of model.parts) {
    const settings={color:part.color??color,roughness:part.roughness??.83,metalness:part.metalness??0,emissive:part.emissive??'#000000'};
    const key=JSON.stringify(settings);
    let material=materials.get(key);
    if(!material){material=new T.MeshStandardMaterial(settings);materials.set(key,material);}
    const mesh=new T.Mesh(partGeometry(part),material);
    mesh.name=part.name;
    mesh.position.fromArray(part.position);
    mesh.scale.fromArray(part.size);
    if(part.rotation)mesh.rotation.set(...part.rotation.map(T.MathUtils.degToRad) as [number,number,number]);
    group.add(mesh);
  }
  return group;
}
