import * as T from 'three';
import type { Pass } from './project';

type Vertex={x:number;y:number;z:number;w:number;eye:number};
const sides=[
  (v:Vertex)=>v.w+v.x,(v:Vertex)=>v.w-v.x,(v:Vertex)=>v.w+v.y,
  (v:Vertex)=>v.w-v.y,(v:Vertex)=>v.w+v.z,(v:Vertex)=>v.w-v.z,
];
const light=new T.Vector3(-.3,.85,.58).normalize();
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const bg=(scene:T.Scene,mode:Pass|'scene')=>{
  if(mode==='normal'||mode==='depth')return [0,0,0];
  if(!(scene.background instanceof T.Color))return [39,45,52];
  const c=scene.background.clone().convertLinearToSRGB();
  return [c.r*255,c.g*255,c.b*255];
};
function clip(input:Vertex[]){
  let poly=input;
  for(const side of sides){
    const next:Vertex[]=[];
    for(let i=0;i<poly.length;i++){
      const a=poly[i],b=poly[(i+1)%poly.length],da=side(a),db=side(b);
      if(da>=0)next.push(a);
      if((da>=0)!==(db>=0)){
        const t=da/(da-db);
        const m=(x:number,y:number)=>x+(y-x)*t;
        next.push({x:m(a.x,b.x),y:m(a.y,b.y),z:m(a.z,b.z),w:m(a.w,b.w),eye:m(a.eye,b.eye)});
      }
    }
    if(next.length<3)return [];
    poly=next;
  }
  return poly;
}
function triangle(input:Vertex[],rgb:number[],mode:Pass|'scene',w:number,h:number,pixels:Uint8ClampedArray,zbuf:Float32Array,near:number,far:number,double:boolean){
  const screen=input.map(p=>({x:(p.x/p.w*.5+.5)*w,y:(.5-p.y/p.w*.5)*h,inv:1/p.w,eye:p.eye}));
  let [a,b,c]=screen;
  let area=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  if(Math.abs(area)<1e-7||area>0&&!double)return;
  if(area>0){[b,c]=[c,b];area=-area;}
  const lx=Math.max(0,Math.ceil(Math.min(a.x,b.x,c.x)-.5)),hx=Math.min(w-1,Math.floor(Math.max(a.x,b.x,c.x)-.5));
  const ly=Math.max(0,Math.ceil(Math.min(a.y,b.y,c.y)-.5)),hy=Math.min(h-1,Math.floor(Math.max(a.y,b.y,c.y)-.5));
  for(let y=ly;y<=hy;y++)for(let x=lx;x<=hx;x++){
    const px=x+.5,py=y+.5;
    const u=((b.x-px)*(c.y-py)-(b.y-py)*(c.x-px))/area;
    const v=((c.x-px)*(a.y-py)-(c.y-py)*(a.x-px))/area;
    const r=1-u-v;if(u<-.00001||v<-.00001||r<-.00001)continue;
    const index=y*w+x;
    const eye=(u*a.eye*a.inv+v*b.eye*b.inv+r*c.eye*c.inv)/(u*a.inv+v*b.inv+r*c.inv);
    if(eye>=zbuf[index])continue;
    zbuf[index]=eye;
    const offset=index*4;
    if(mode==='depth'){
      const gray=255*(1-clamp((eye-near)/(far-near)));
      pixels[offset]=gray;pixels[offset+1]=gray;pixels[offset+2]=gray;
    } else {
      pixels[offset]=rgb[0];pixels[offset+1]=rgb[1];pixels[offset+2]=rgb[2];
    }
  }
}

export class SoftwareRenderer {
  domElement=document.createElement('canvas');
  autoClear=true;
  mode:Pass|'scene'='scene';
  private ctx=this.domElement.getContext('2d',{alpha:false})!;
  private limit:number;
  private cssWidth=0;
  private cssHeight=0;
  private depth:Float32Array|null=null;
  constructor(limit=480){this.limit=limit;}
  setPixelRatio(_ratio:number){}
  setSize(w:number,h:number,updateStyle=true){
    const factor=Math.min(1,this.limit/Math.max(w,h));
    const nx=Math.max(1,Math.round(w*factor)),ny=Math.max(1,Math.round(h*factor));
    if(this.domElement.width!==nx||this.domElement.height!==ny){this.domElement.width=nx;this.domElement.height=ny;}
    if(updateStyle&&(w!==this.cssWidth||h!==this.cssHeight)){
      this.domElement.style.width=w+'px';this.domElement.style.height=h+'px';this.cssWidth=w;this.cssHeight=h;
    }
  }
  render(scene:T.Scene,camera:T.PerspectiveCamera) {
    const {width:w,height:h}=this.domElement;
    if(w<1||h<1)return;
    scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);
    const vp=new T.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    if(this.autoClear){
      const frame=this.ctx.createImageData(w,h);
      const pixels=frame.data,[r,g,b]=bg(scene,this.mode);
      for(let k=0;k<pixels.length;k+=4){pixels[k]=r;pixels[k+1]=g;pixels[k+2]=b;pixels[k+3]=255;}
      const zbuf=new Float32Array(w*h).fill(Infinity);this.depth=zbuf;
      const normal=new T.Vector3(),d1=new T.Vector3(),d2=new T.Vector3();
      scene.traverseVisible(o=>{
        if(!(o instanceof T.Mesh))return;
        const mat=Array.isArray(o.material)?o.material[0]:o.material;
        if(!mat.visible)return;
        const attr=o.geometry.getAttribute('position'),index=o.geometry.index;
        const transform=new T.Matrix4().multiplyMatrices(vp,o.matrixWorld);
        const view=new T.Matrix4().multiplyMatrices(camera.matrixWorldInverse,o.matrixWorld);
        const points:T.Vector3[]=[],verts:Vertex[]=[];
        for(let i=0;i<attr.count;i++){
          const pos=o.getVertexPosition(i,new T.Vector3());
          points.push(pos.clone().applyMatrix4(o.matrixWorld));
          const q=new T.Vector4(pos.x,pos.y,pos.z,1).applyMatrix4(transform);
          verts.push({x:q.x,y:q.y,z:q.z,w:q.w,eye:-pos.applyMatrix4(view).z});
        }
        const color=this.mode==='clay'?new T.Color('#aab0b6'):((mat as T.MeshStandardMaterial).color??new T.Color('#9faab4')).clone();
        const srgb=color.convertLinearToSRGB();
        for(let j=0;j<(index?index.count:attr.count);j+=3){
          const a=index?index.getX(j):j,b=index?index.getX(j+1):j+1,c=index?index.getX(j+2):j+2;
          const va=verts[a],vb=verts[b],vc=verts[c];
          const codes=[va,vb,vc].map(v=>sides.reduce((code,fn,i)=>code|(fn(v)<0?1<<i:0),0));
          if(codes[0]&codes[1]&codes[2])continue;
          const polygon=(codes[0]|codes[1]|codes[2])?clip([va,vb,vc]):[va,vb,vc];
          if(polygon.length<3)continue;
          normal.copy(d1.subVectors(points[b],points[a]).cross(d2.subVectors(points[c],points[a]))).normalize();
          let rgb:number[];
          if(this.mode==='normal'){
            normal.transformDirection(camera.matrixWorldInverse);
            rgb=[normal.x,normal.y,normal.z].map(v=>(v*.5+.5)*255);
          }else{
            const shade=(mat instanceof T.MeshBasicMaterial)?1:.58+.42*Math.max(0,normal.dot(light));
            rgb=[srgb.r,srgb.g,srgb.b].map(v=>v*255*shade);
          }
          for(let k=1;k<polygon.length-1;k++)triangle([polygon[0],polygon[k],polygon[k+1]],rgb,this.mode,w,h,pixels,zbuf,camera.near,camera.far,mat.side===T.DoubleSide);
        }
      });
      this.ctx.putImageData(frame,0,0);
    } else {
      this.ctx.lineWidth=1;
      scene.traverseVisible(o=>{
        if(!(o instanceof T.Line)||!o.material||Array.isArray(o.material))return;
        const attr=o.geometry.getAttribute('position'), index=o.geometry.index;
        const mv=new T.Matrix4().multiplyMatrices(vp,o.matrixWorld);
        const point=(i:number)=>{
          const off=index?index.getX(i):i;
          return new T.Vector4(attr.getX(off),attr.getY(off),attr.getZ(off),1).applyMatrix4(mv);
        };
        const grid=o instanceof T.GridHelper;
        this.ctx.strokeStyle=grid?'#47515c':'#'+(o.material as T.LineBasicMaterial).color.getHexString();
        this.ctx.lineWidth=grid?1:1.2;
        this.ctx.globalAlpha=grid?.56:1;
        this.ctx.beginPath();
        for(let i=0;i+1<(index?index.count:attr.count);i+=o instanceof T.LineSegments?2:1){
          const a=point(i),b=point(i+1);
          if(a.w<=0||b.w<=0)continue;
          const ax=a.x/a.w,ay=a.y/a.w,bx=b.x/b.w,by=b.y/b.w;
          if(Math.min(ax,bx)>1||Math.max(ax,bx)<-1||Math.min(ay,by)>1||Math.max(ay,by)<-1)continue;
          const x0=(ax*.5+.5)*w,y0=(.5-ay*.5)*h,x1=(bx*.5+.5)*w,y1=(.5-by*.5)*h;
          if(!grid||!this.depth){this.ctx.moveTo(x0,y0);this.ctx.lineTo(x1,y1);continue;}
          const steps=Math.min(1600,Math.ceil(Math.hypot(x1-x0,y1-y0)));
          let segment=false;
          for(let j=0;j<=steps;j++){
            const t=steps?j/steps:0, px=x0+(x1-x0)*t,py=y0+(y1-y0)*t;
            const eye=1/((1-t)/a.w+t/b.w);
            const visible=px>=0&&px<w&&py>=0&&py<h&&eye<=this.depth[Math.floor(py)*w+Math.floor(px)]+.08;
            if(visible&&segment)this.ctx.lineTo(px,py);
            if(visible&&!segment)this.ctx.moveTo(px,py);
            segment=visible;
          }
        }
        this.ctx.stroke();this.ctx.globalAlpha=1;
      });
    }
  }
  marker(pt:T.Vector3,camera:T.PerspectiveCamera,color:string){
    const {width:w,height:h}=this.domElement;
    const q=pt.clone().project(camera);
    if(q.z< -1||q.z>1)return;
    this.ctx.fillStyle=color;this.ctx.beginPath();this.ctx.arc((q.x*.5+.5)*w,(.5-q.y*.5)*h,3.2,0,Math.PI*2);this.ctx.fill();
  }
  drawGizmo(pt:T.Vector3,camera:T.PerspectiveCamera,mode:string){
    const {width,height}=this.domElement;
    const project=(p:T.Vector3)=>{const q=p.clone().project(camera);return [(q.x*.5+.5)*width,(.5-q.y*.5)*height];};
    const [x,y]=project(pt);
    const extent=pt.distanceTo(camera.position)*.115;
    const directions=[new T.Vector3(1,0,0),new T.Vector3(0,1,0),new T.Vector3(0,0,1)];
    const colors=['#fa7563','#81d09b','#729efa'];
    for(const [i,direction] of directions.entries()){
      const [xp,yp]=project(pt.clone().addScaledVector(direction,extent));
      this.ctx.lineWidth=2;this.ctx.strokeStyle=colors[i];this.ctx.fillStyle=colors[i];
      this.ctx.beginPath();this.ctx.moveTo(x,y);this.ctx.lineTo(xp,yp);this.ctx.stroke();
      if(mode==='scale')this.ctx.fillRect(xp-3,yp-3,6,6);
      else{this.ctx.beginPath();this.ctx.arc(xp,yp,3,0,Math.PI*2);this.ctx.fill();}
    }
    this.marker(pt,camera,'#f2ecd7');
  }
  dispose(){}
  forceContextLoss(){}
}
