import { zipSync } from 'fflate';
import { guideSlot, utf } from './export';
import { readMedia, type Media } from './media';
import { activeSequence, passes, type Pass, type Project, type Shot } from './project';
import { characterKey, characterViews, cinematicImage, cinematicKey, dataURL, imageSlots, meta, mimeExt, shotMediaKey, styleKey } from './references';

export const seedanceModel='dreamina-seedance-2-5-260628';
export type SeedanceMode='omni'|'frames'|'text';
export type SeedanceOptions={mode:SeedanceMode;duration:number;ratio:string;resolution:string;audio:boolean};
type Item={id:string;label:string;role:'reference_video'|'reference_image'|'first_frame'|'last_frame';media:Media;approved?:boolean;experimental?:boolean;issue?:string};
export const guideLabels:Record<Pass,string>={clay:'Clay · camera, composition and motion reference',depth:'Depth · experimental general video reference',normal:'Normal · experimental general video reference',pose:'Pose · experimental proxy-joint video'};
export const shotPrompt=(p:Project,shot:Shot)=>{
  const camera=p.cameras.find(c=>c.id===shot.cameraId);
  const objects=new Map(p.stage.objects.map(o=>[o.id,o]));
  const active=p.tracks.filter(t=>objects.get(t.objectId)?.visible).map(t=>objects.get(t.objectId)?.name+' '+t.action);
  const style=['environment','style'].map(s=>meta(styleKey(p,s)).description).filter(Boolean);
  const identity=p.stage.objects.filter(o=>o.kind==='character').map(o=>{
    const notes=meta(characterKey(p,o,'profile'));
    return [o.name,notes.description,notes.appearance,notes.clothing].filter(Boolean).join(', ');
  });
  return [shot.prompt,p.script,'Shot '+shot.name+' in '+activeSequence(p).name+'. Previs interval '+shot.start+'–'+(shot.start+shot.duration)+' s.',
    camera?'Camera '+camera.name+', '+camera.fov+'° vertical FOV. Preserve the supplied composition and camera trajectory.':'',
    active.length?'Blocking: '+active.join('; ')+'.':'',identity.length?'Continuity: '+identity.join('; ')+'. Maintain established details across shots.':'',
    style.length?'Lighting and style: '+style.join('. ')+'.':''].filter(Boolean).join('\n\n').slice(0,15500);
};
async function dimensions(m:Media){
  if(m.width&&m.height)return [m.width,m.height];
  const bitmap=await createImageBitmap(m.blob);
  const size=[bitmap.width,bitmap.height];bitmap.close();return size;
}
async function imageIssue(m:Media){
  if(!/^image\/(png|jpeg|webp)$/.test(m.blob.type)||m.blob.size>=30*1024*1024)return 'Requires a compatible image under 30 MB.';
  try{const [w,h]=await dimensions(m);if(w<300||h<300||w>6000||h>6000||w/h<.4||w/h>2.5)return 'Use 300–6000 px per dimension and aspect ratio 0.4–2.5.';}
  catch{return 'The browser could not decode this image.';}
}
export const videoIssue=(m:Media)=>{
  if(m.blob.size>200*1024*1024)return 'Reference exceeds the provider size limit.';
  const {duration,width,height,fps}=m;
  if(!duration||duration<2||duration>30)return 'Reference must be 2–30 seconds.';
  if(!width||!height||width*height<407696||width*height>8295044||width<300||height<300||width/height<.4||width/height>2.5)return 'Use 480 × 854 or larger provider-compatible resolution.';
  if(fps&&(fps<24||fps>60))return 'Reference frame rate must be 24–60 fps.';
};
export async function inspectVideo(file:File):Promise<Media>{
  if(!/\.(mp4|mov)$/i.test(file.name)||file.size>150*1024*1024)throw Error('Choose an MP4 or MOV up to 150 MB.');
  const src=URL.createObjectURL(file),video=document.createElement('video');video.preload='metadata';video.src=src;
  try{
    await new Promise<void>((resolve,reject)=>{video.onloadedmetadata=()=>resolve();video.onerror=()=>reject(Error('The browser could not read video metadata.'));});
    if(!Number.isFinite(video.duration))throw Error('Video duration could not be measured.');
    return {blob:file,name:file.name,width:video.videoWidth,height:video.videoHeight,duration:video.duration};
  }finally{video.removeAttribute('src');video.load();URL.revokeObjectURL(src);}
}
export async function collectSeedance(p:Project,shot:Shot,mode:SeedanceMode):Promise<Item[]>{
  if(mode==='text')return [];
  const result:Item[]=[];
  if(mode==='omni')for(const pass of passes){
    const m=await readMedia(shotMediaKey(p,shot,guideSlot(pass)));
    if(m)result.push({id:pass,label:guideLabels[pass],role:'reference_video',media:m,experimental:pass!=='clay',issue:videoIssue(m)});
  }
  for(const slot of imageSlots){
    if(mode==='frames'&&slot==='intermediate')continue;
    const key=cinematicKey(p,shot,slot),m=await cinematicImage(p,shot,slot);
    if(m&&meta(key).approved)result.push({id:slot,label:'Cinematic '+slot,role:mode==='omni'?'reference_image':slot==='opening'?'first_frame':'last_frame',media:m,approved:true,issue:await imageIssue(m)});
  }
  if(mode==='frames')return result;
  const add=async (key:string,label:string)=>{
    const m=await readMedia(key);
    if(m&&meta(key).approved)result.push({id:key,label,role:'reference_image',media:m,approved:true,issue:await imageIssue(m)});
  };
  for(const slot of ['environment','style'])await add(styleKey(p,slot),slot);
  const identities=new Set<string>();
  for(const actor of p.stage.objects.filter(o=>o.kind==='character')){
    const id=actor.identityId??actor.id;
    if(identities.has(id))continue;identities.add(id);
    for(const view of characterViews)await add(characterKey(p,actor,view),actor.name+' · '+view);
  }
  return result;
}
function picked(items:Item[],enabled:string[],opt:SeedanceOptions){
  const selected=items.filter(item=>enabled.includes(item.id));
  if(selected.some(i=>i.issue))throw Error(selected.find(i=>i.issue)?.issue);
  const videos=selected.filter(i=>i.role==='reference_video');
  if(videos.length>10||videos.reduce((n,i)=>n+(i.media.duration??0),0)>30)throw Error('Select at most 10 reference videos with no more than 30 seconds combined.');
  if(selected.length-videos.length>30)throw Error('Select at most 30 reference images.');
  if(opt.mode==='frames'&&selected[0]?.role!=='first_frame')throw Error('Approve and enable a cinematic opening frame.');
  if(opt.mode==='omni'&&!selected.length)throw Error('Enable a compatible guide or approved image, or choose Text to video.');
  if(!Number.isInteger(opt.duration)||opt.duration<4||opt.duration>30)throw Error('Output duration must be an integer from 4 to 30 seconds.');
  return selected;
}
export function videoPrompt(prompt:string,selected:Item[],mode:SeedanceMode){
  if(mode!=='omni')return prompt;
  let images=0,videos=0;
  const cues=selected.map(i=>i.role==='reference_video'
    ?'@Video'+(++videos)+' — '+(i.id==='clay'?'Follow the timing, framing and movement':i.label+' for optional visual guidance')
    :'@Image'+(++images)+' — '+i.label);
  return prompt+'\n\nReference roles\n'+cues.join('\n');
}
export async function seedanceBundle(p:Project,shot:Shot,prompt:string,items:Item[],enabled:string[],opt:SeedanceOptions){
  const selected=picked(items,enabled,opt);
  const files:Record<string,Uint8Array>={};
  const manifest=[];
  for(const [i,item] of selected.entries()){
    const path='references/'+String(i+1).padStart(2,'0')+'-'+item.role+'.'+mimeExt(item.media);
    files[path]=new Uint8Array(await item.media.blob.arrayBuffer());
    manifest.push({path,role:item.role,label:item.label,experimental:item.experimental??false});
  }
  files['prompt.txt']=new TextEncoder().encode(videoPrompt(prompt,selected,opt.mode));
  files['request.json']=utf({model:seedanceModel,...opt,ratio:opt.mode==='frames'?'adaptive':opt.ratio,references:manifest,project:p.title,shot:shot.name,
    notes:'Attach only the files listed here, in order, using the indicated mode. General guide videos are references rather than dedicated conditioning.'});
  files['shot.json']=utf(shot);
  return zipSync(files,{level:0});
}
export async function seedanceRequest(prompt:string,items:Item[],enabled:string[],opt:SeedanceOptions,urls:Record<string,string>){
  const selected=picked(items,enabled,opt);
  if(selected.filter(item=>item.role!=='reference_video').reduce((n,i)=>n+i.media.blob.size,0)>34*1024*1024)throw Error('Combined images exceed the inlined request limit.');
  const assets=await Promise.all(selected.map(async item=>{
    const isVideo=item.role==='reference_video';
    const url=isVideo?(urls[item.id]??'').trim():await dataURL(item.media.blob);
    if(isVideo&&!/^(https:\/\/[^\s]+|asset:\/\/[\w-]+)$/.test(url))throw Error('Enter a public HTTPS URL or supported ModelArk asset ID for '+item.id+', or use the manual package.');
    return {kind:isVideo?'video_url':'image_url',role:item.role,url};
  }));
  return {mode:opt.mode,prompt:videoPrompt(prompt,selected,opt.mode),duration:opt.duration,ratio:opt.mode==='frames'?'adaptive':opt.ratio,resolution:opt.resolution,generate_audio:opt.audio,assets,confirm_charge:true};
}
