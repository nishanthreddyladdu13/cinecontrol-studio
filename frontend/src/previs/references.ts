import { zipSync } from 'fflate';
import { type Project, type Shot, type StageObject } from './project';
import { readMedia, writeMedia, type Media } from './media';
import { utf } from './export';

export type ImageSlot='opening'|'ending'|'intermediate';
export const imageSlots:ImageSlot[]=['opening','ending','intermediate'];
export const characterViews=['sheet','front','left','right','back','three-quarter'] as const;
export const cameraSlots=['opening','ending','current'] as const;
export type CameraSlot=typeof cameraSlots[number];
const lookup=(p:Project,s:Shot)=>p.id+'/'+s.id+'/';
export const cameraKey=(p:Project,s:Shot,slot:CameraSlot)=>lookup(p,s)+'cam-'+slot;
export const cinematicKey=(p:Project,s:Shot,slot:ImageSlot)=>lookup(p,s)+'cine-'+slot;
export const styleKey=(p:Project,slot:string)=>p.id+'/style/'+slot;
export const characterKey=(p:Project,o:StageObject,slot:string)=>p.id+'/identity/'+(o.identityId??o.id)+'/'+slot;
export const shotMediaKey=(p:Project,s:Shot,slot:string)=>lookup(p,s)+slot;
export type RefMeta={prompt?:string;approved?:boolean;fingerprint?:string;time?:number;description?:string;clothing?:string;appearance?:string};
export function meta(key:string):RefMeta{
  try{return JSON.parse(localStorage.getItem(key+'/meta')??'{}');}catch{return {};}
}
export function putMeta(key:string,update:RefMeta){
  localStorage.setItem(key+'/meta',JSON.stringify({...meta(key),...update}));
}
export function sceneFingerprint(p:Project,shot:Shot):string {
  const relevant=JSON.stringify([p.stage,p.tracks,p.cameras.find(c=>c.id===shot.cameraId),shot.start,shot.duration]);
  let hash=0;
  for(let i=0;i<relevant.length;i++)hash=Math.imul(hash,31)+relevant.charCodeAt(i)|0;
  return String(hash);
}
export const cameraPrompt=(p:Project,s:Shot)=>
  'Create a polished photorealistic cinematic frame. Use the supplied 3D camera frame as a geometric guide. Keep framing, perspective and relative placement of visible people, props and surfaces. Maintain character identity, clothing and set continuity.\n\nScene: '+p.script+'\n\nShot: '+s.name+'\n'+s.prompt+'\n\nStage: '+(p.stageName??'Current stage')+' · '+p.stage.objects.filter(o=>o.visible).slice(0,15).map(o=>o.name).join(', ')+(meta(styleKey(p,'style')).description?'\n\nVisual style and lighting: '+meta(styleKey(p,'style')).description:'');
export const characterPrompt=(p:Project,o:StageObject,view:string)=>{
  const m=meta(characterKey(p,o,'profile'));
  return 'Identity reference for '+o.name+' · '+o.size[1].toFixed(2)+' m tall. Match the same identity, face, body proportions and clothing in every view. Use a consistent neutral background and even lighting. Supply '+(view==='sheet'?'front, left, right, back and three-quarter views on a labeled sheet':view+' view, using the approved sheet or front view as identity input')+'.\n\nDescription: '+(m.description??'')+'\nAppearance: '+(m.appearance??'')+'\nClothing: '+(m.clothing??'');
};
export const mimeExt=(m:Media)=>{
  const ext=m.name.split('.').at(-1)?.toLowerCase().replace(/[^a-z0-9]/g,'');
  return ext||'bin';
};
export async function cameraImage(p:Project,s:Shot,slot:ImageSlot){
  return await readMedia(cameraKey(p,s,slot==='intermediate'?'current':slot));
}
export async function cinematicImage(p:Project,s:Shot,slot:ImageSlot){
  return await readMedia(cinematicKey(p,s,slot))?? await readMedia(shotMediaKey(p,s,slot));
}
export async function storeImage(key:string,file:Media){
  if(!/^image\/(png|jpeg|webp)$/.test(file.blob.type)||file.blob.size>20*1024*1024)throw Error('Choose a PNG, JPEG or WebP up to 20 MB.');
  await writeMedia(key,file);putMeta(key,{approved:false});
}
export async function imagePromptPack(p:Project,s:Shot,slot:ImageSlot,prompt:string){
  const frame=await cameraImage(p,s,slot);
  if(!frame)throw Error('Capture the corresponding 3D camera frame first.');
  const zip:Record<string,Uint8Array>={'camera-frame.png':new Uint8Array(await frame.blob.arrayBuffer()),'prompt.txt':new TextEncoder().encode(prompt),'shot.json':utf(s)};
  for(const kind of ['environment','style']){
    const key=styleKey(p,kind),image=await readMedia(key);
    if(image&&meta(key).approved)zip[kind+'.'+mimeExt(image)]=new Uint8Array(await image.blob.arrayBuffer());
  }
  return zipSync(zip,{level:0});
}
export function dataURL(blob:Blob){
  return new Promise<string>((resolve,reject)=>{
    const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(r.error);r.readAsDataURL(blob);
  });
}
