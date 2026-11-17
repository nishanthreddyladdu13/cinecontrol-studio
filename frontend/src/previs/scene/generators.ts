import type { V3 } from '../project';
import type { Assembly, Part } from './model';

type Parameters={floors?:number; windows?:boolean; balconies?:boolean; parapet?:boolean; roof?:'flat'|'pitched'; door?:boolean; variant?:'deciduous'|'pine'; seed?:number};
type Builder=(size:V3,color:string,p:Parameters,enhanced:boolean)=>Part[];
const box=(name:string,position:V3,size:V3,color?:string):Part=>({shape:'box',name,position,size,color});
const soft=(shape:'sphere'|'cylinder'|'cone'|'capsule'|'torus',name:string,position:V3,size:V3,color?:string,rotation?:V3):Part=>({shape,name,position,size,color,rotation});
const glass='#396273',frame='#d9dee2',dark='#3d4751',light='#e1b479';
const thickness=(n:number)=>Math.max(.01,n);
const lintels=(w:number,h:number,d:number)=>box('Cornice',[0,h,0],[w*1.015,.07,d*1.015],dark);

const building:Builder=([w,h,d],color,p,enhanced)=>{
  const floors=Math.min(p.floors??Math.max(1,Math.round(h/3)),enhanced?12:5);
  const roofHeight=p.roof==='pitched'?Math.min(h*.22,d*.22):0;
  const wall=h-roofHeight;
  const parts:Part[]=[box('Main structure',[0,wall/2,0],[w,wall,d],color)];
  if(roofHeight)parts.push({shape:'prism',name:'Pitched roof',profile:[[-.5,-.5],[.5,-.5],[0,.5]],
    position:[0,wall+roofHeight/2,0],size:[w*1.045,roofHeight,d*1.03],color:dark});
  else {
    parts.push(lintels(w,h-.04,d));
    if(p.parapet) {
      const rimHeight=Math.min(.9,h*.18),t=Math.min(.18,w*.15,d*.15);
      for(const side of [-1,1]) {
        parts.push(box('Roof parapet',[0,h+rimHeight/2,side*(d-t)/2],[w,rimHeight,t],color));
        parts.push(box('Roof parapet',[side*(w-t)/2,h+rimHeight/2,0],[t,rimHeight,d-2*t],color));
      }
    }
  }
  if(p.door!==false){
    const doorHeight=Math.min(2.2,wall/floors*.82), doorWidth=Math.min(1.45,w*.26);
    parts.push(box('Entrance',[0,doorHeight/2,d/2+.035],[doorWidth,doorHeight,.075],dark));
  }
  if(p.windows!==false){
    const stories=wall/floors, columns=Math.min(enhanced?6:3,Math.max(1,Math.round(w/2.3)));
    for(let row=0;row<floors;row++)for(let col=0;col<columns;col++){
      if(row===0&&p.door!==false&&Math.abs((col+.5)/columns-.5)<.2)continue;
      const x=((col+.5)/columns-.5)*w, y=(row+.57)*stories, width=w/columns*.64;
      parts.push(box('Window frame',[x,y,d/2+.043],[width,stories*.49,.10],frame));
      parts.push({...box('Glazing',[x,y,d/2+.103],[width*.86,stories*.4,.027],glass),metalness:.45,roughness:.23});
    }
  }
  if(p.balconies)for(let row=1;row<Math.min(floors,5);row++){
    const y=row*wall/floors, width=w*.63, depth=Math.min(1.3,d*.24);
    parts.push(box('Balcony slab',[0,y-.07,d/2+depth/2],[width,.14,depth],frame));
    parts.push(box('Balcony guard',[0,y+.5,d/2+depth],[width,1,.07],dark));
  }
  return parts;
};

const room:Builder=([w,h,d],color,p)=>{
  const t=Math.min(.2,w*.12,d*.12), parts=[box('Floor',[0,t/2,0],[w,t,d],'#647482'),
    box('Rear wall',[0,h/2,-(d-t)/2],[w,h,t],color),
    box('Left wall',[-(w-t)/2,h/2,0],[t,h,d],color)];
  const span=p.door===false?0:Math.min(1.2,d*.32);
  if(!span)parts.push(box('Right wall',[(w-t)/2,h/2,0],[t,h,d],color));
  else {
    const jamb=(d-span)/2,doorY=Math.min(2.1,h*.8);
    for(const side of [-1,1])parts.push(box('Doorway jamb',[(w-t)/2,h/2,side*(span+jamb)/2],[t,h,jamb],color));
    parts.push(box('Doorway lintel',[(w-t)/2,(h+doorY)/2,0],[t,h-doorY,span],color));
  }
  parts.push(box('Rear skirting',[0,t+.09,-d/2+t],[w,.18,.035],dark));
  return parts;
};

const deck:Builder=([w,h,d],color,p,enhanced)=>{
  const slab=Math.min(.25,h);
  const parts=[box('Deck slab',[0,h-slab/2,0],[w,slab,d],color)];
  if(p.parapet!==false){
    const rail=Math.min(.12,w*.15,d*.15),guard=Math.min(1.05,w*.5);
    parts.push(box('Front rail',[0,h+guard,d/2-rail],[w,rail,rail],dark));
    const posts=Math.min(enhanced?12:5,Math.max(2,Math.round(w/.9)));
    for(let i=0;i<posts;i++)parts.push(box('Guard post',[(i/(posts-1)-.5)*(w-rail),h+guard/2,d/2-rail],[rail,guard,rail],dark));
  }
  return parts;
};

const tree:Builder=([w,h,d],color,p,enhanced)=>{
  const parts=[soft('cylinder','Trunk',[0,h*.32,0],[w*.15,h*.64,d*.15],'#74543a')];
  if(p.variant==='pine'){
    for(let i=0;i<(enhanced?4:3);i++){
      const radius=1-i*.17;
      parts.push(soft('cone','Needle layer',[0,h*(.43+i*.12),0],[w*radius,h*.42,d*radius],i%2?'#426c48':color));
    }
  }else{
    parts.push(soft('sphere','Crown',[0,h*.73,0],[w*.78,h*.54,d*.8],color));
    for(const side of [-1,1])parts.push(soft('sphere','Side foliage',[side*w*.22,h*.67,side*d*.12],[w*.54,h*.38,d*.55],side>0?'#66845a':color));
    if(enhanced)parts.push(soft('sphere','New growth',[w*.11,h*.83,-d*.2],[w*.42,h*.3,d*.4],'#779364'));
  }
  return parts;
};

const terrain:Builder=([w,h,d],color,p,enhanced)=>{
  const n=enhanced?11:6, seed=p.seed??1,vertices:V3[]=[],triangles:[number,number,number][]=[];
  for(let z=0;z<n;z++)for(let x=0;x<n;x++){
    const a=x/(n-1),b=z/(n-1);
    const wave=.25*Math.sin(a*8+seed)*Math.cos(b*7-seed)+.16*Math.sin(a*15-b*12+seed);
    vertices.push([a-.5,wave,b-.5]);
    if(x&&z){const index=z*n+x;triangles.push([index-n-1,index-1,index],[index-n-1,index,index-n]);}
  }
  return [{shape:'mesh',name:'Rolling terrain',position:[0,h*.5,0],size:[w,h,d],color,vertices,triangles}];
};

const road:Builder=([w,h,d],color,_,enhanced)=>{
  const parts=[box('Road surface',[0,h/2,0],[w,h,d],color)];
  const stripes=Math.min(enhanced?24:10,Math.max(1,Math.floor(d/3)));
  for(let i=0;i<stripes;i++)parts.push(box('Lane marking',[0,h+.005,((i+.5)/stripes-.5)*d],[Math.min(.10,w*.12),.01,d/stripes*.5],'#e5d6a9'));
  for(const side of [-1,1])parts.push(box('Edge marking',[side*w*.44,h+.005,0],[Math.min(.07,w*.12),.01,d],'#a4a9ad'));
  return parts;
};

const bench:Builder=([w,h,d],color)=>{
  const parts:Part[]=[];
  for(const side of [-1,1]){
    parts.push(box('Cast foot',[side*w*.34,h*.24,0],[w*.07,h*.48,d*.82],dark));
    parts.push(box('Back support',[side*w*.34,h*.69,-d*.37],[w*.04,h*.61,d*.09],dark));
  }
  for(let i=0;i<4;i++)parts.push(box('Wood seat slat',[0,h*.48,(i-1.5)*d*.22],[w,h*.07,d*.18],color));
  for(let i=0;i<3;i++)parts.push(box('Wood back slat',[0,h*(.62+i*.16),-d*.40],[w,h*.12,d*.10],color));
  return parts;
};

const lantern:Builder=([w,h,d],color)=>{
  const parts:Part[]=[soft('cylinder','Metal base',[0,h*.08,0],[w,h*.16,Math.min(w,d)],color),
    {...box('Warm diffuser',[0,h*.48,0],[w*.58,h*.65,d*.58],light),emissive:'#6b350d'},
    soft('cone','Metal shade',[0,h*.86,0],[w,h*.24,d],color)];
  for(const x of [-.34,.34])for(const z of [-.34,.34])parts.push(box('Frame upright',[x*w,h*.47,z*d],[w*.09,h*.65,d*.09],color));
  return parts;
};

const crate:Builder=([w,h,d],color)=>{
  const parts=[box('Crate body',[0,h/2,0],[w,h,d],color)];
  for(const x of [-.37,.37])for(const z of [-.5,.5])parts.push(box('Corner reinforcement',[x*w,h/2,z*d],[w*.13,h,d*.04],dark));
  const brace=box('Diagonal brace',[0,h*.5,d*.53],[Math.hypot(w*.7,h*.65),h*.1,d*.04],'#8e704b');
  parts.push({...brace,rotation:[0,0,Math.atan2(h*.65,w*.7)*180/Math.PI]});
  return parts;
};

export const generators={building,room,deck,tree,terrain,road,bench,lantern,crate};
export type Generator=keyof typeof generators;
export const generatorParameters={
  building:['floors','windows','balconies','parapet','roof','door'],
  room:['door'],deck:['parapet'],tree:['variant'],terrain:['seed'],
  road:[],bench:[],lantern:[],crate:[],
} satisfies Record<Generator,(keyof Parameters)[]>;

export function generateModel(name:Generator,size:V3,color:string,params:Parameters={},quality='enhanced'):Assembly {
  return {size,parts:generators[name](size,color,params,quality==='enhanced').map(part=>({...part,size:part.size.map(thickness) as V3}))};
}
