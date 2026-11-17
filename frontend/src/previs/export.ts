import { zipSync } from 'fflate';
import { type Pass, type Project, type Shot } from './project';
import type { Viewport } from './viewport';
import { json, writeMedia } from './media';

export type ExportKind='preview'|'guides'|'png';
export type Layout='separate'|'stitched'|'both';
export type RenderOptions={width:number;height:number;fps:number;start:number;end:number;passes:Pass[];kind:ExportKind;layout:Layout};
type RenderPass=Pass|'scene';
const passesMetadata={
  depth:'Camera-forward depth, 8-bit linear. White is 0.04 m, black is 95 m. Background black.',
  normal:'Camera-space XYZ encoded in RGB via n × 0.5 + 0.5. Background black.',
  pose:'COCO-18 order proxy joints projected into the camera. 1 means the joint is within frame; occlusion is not tested. These are not motion-capture or a tracked skeletal rig.',
  video:'MP4 uses H.264/YUV 4:2:0 for playback. Use PNGs or numeric metadata for data-sensitive processing.',
};
const bytes=(data:string)=>Uint8Array.from(atob(data.split(',')[1]),c=>c.charCodeAt(0));
export const utf=(data:unknown)=>new TextEncoder().encode(json(data));
const numbered=(n:number)=>String(n).padStart(5,'0')+'.png';
export const guideSlot=(pass:Pass)=>'guide-'+pass;

async function encode(frames:Uint8Array[],fps:number,pass:RenderPass){
  const packed=zipSync(Object.fromEntries(frames.map((data,i)=>[numbered(i+1),data])),{level:0});
  const response=await fetch('/api/previs/encode?fps='+fps+'&data_pass='+String(!['scene','clay'].includes(pass)),{
    method:'POST',body:new Uint8Array(packed),signal:AbortSignal.timeout(125000),
  });
  if(!response.ok){
    const e=await response.json().catch(()=>null);
    throw Error(e?.detail??'The MP4 encoder did not respond. Check that the FastAPI server is running.');
  }
  const data=new Uint8Array(await response.arrayBuffer());
  if(String.fromCharCode(...data.slice(4,8))!=='ftyp')throw Error('The encoder did not return an MP4.');
  return data;
}
export async function renderExport(engine:Viewport,p:Project,shots:Shot[],opt:RenderOptions,update:(msg:string,pct:number)=>void){
  const selected:RenderPass[]=opt.kind==='preview'?['scene']:opt.passes;
  if(!selected.length)throw Error('Choose at least one guidance pass.');
  const entries=shots.map(shot=>{
    const start=Math.min(shot.duration,Math.max(0,opt.start)), end=opt.end===0?shot.duration:Math.min(shot.duration,opt.end);
    const count=Math.ceil((end-start)*opt.fps-1e-8);
    if(count<1)throw Error(shot.name+' has an empty export range.');
    return {shot,start,end,count};
  });
  const count=entries.reduce((acc,s)=>acc+s.count,0);
  if(count>1800||count*selected.length*opt.width*opt.height>3_000_000_000)throw Error('Export is too large. Use a shorter range, fewer passes or a lower resolution.');
  const files:Record<string,Uint8Array>={};
  const completed:{name:string;filesize:number}[]=[];
  const stitched:Record<RenderPass,Uint8Array[]>={scene:[],clay:[],depth:[],normal:[],pose:[]};
  const starts=entries.map(x=>({id:x.shot.id,shotTime:x.start,blockingTime:x.shot.start+x.start,frameCount:x.count}));
  const warnings:string[]=[];
  let done=0,sequenceFrame=0;
  const saveVideo=async (name:string,frames:Uint8Array[],pass:RenderPass,shot?:Shot)=>{
    update('Encoding '+name,Math.floor(92*done/count));
    try{
      const data=await encode(frames,opt.fps,pass);
      files[name]=data;completed.push({name,filesize:data.byteLength});
      const entry=entries.find(e=>e.shot.id===shot?.id);
      if(pass!=='scene'&&shot&&entry?.start===0&&entry.end===shot.duration){
        const blob=new Blob([new Uint8Array(data)],{type:'video/mp4'});
        await writeMedia(p.id+'/'+shot.id+'/'+guideSlot(pass),{blob,name:name.split('/').at(-1)!,duration:frames.length/opt.fps,width:opt.width,height:opt.height,fps:opt.fps});
      }
    }catch(error){
      warnings.push(name+': '+(error instanceof Error?error.message:String(error)));
    }
  };
  try {
    for(const {shot,start,count:frames} of entries){
      const meta:unknown[]=[];
      const data:Record<RenderPass,Uint8Array[]>={scene:[],clay:[],depth:[],normal:[],pose:[]};
      for(let i=0;i<frames;i++){
        const local=start+i/opt.fps,t=shot.start+local;
        const result=engine.capture(shot,t,opt.width,opt.height,selected);
        for(const pass of selected){
          const value=bytes(result.frames[pass]);
          if(opt.kind==='png')files[shot.id+'/'+pass+'/'+numbered(i+1)]=value;
          else {
            data[pass].push(value);
            if(opt.layout!=='separate'&&shots.length>1)stitched[pass].push(value);
          }
        }
        meta.push({frame:i+1,sequenceFrame:++sequenceFrame,shotTime:local,blockingTime:t,camera:result.camera,pose:result.pose});
        done++;
        if(i%3===0){update('Rendering '+shot.name+' · '+done+' / '+count+' frames',Math.floor(92*done/count));await new Promise(r=>setTimeout(r,0));}
      }
      files[shot.id+'/frames.json']=utf(meta);
      if(opt.kind!=='png'&&(opt.layout!=='stitched'||shots.length===1)){
        for(const pass of selected)await saveVideo(shot.id+'/'+(pass==='scene'?'preview':pass)+'.mp4',data[pass],pass,shot);
      }
    }
    if(opt.kind!=='png'&&opt.layout!=='separate'&&shots.length>1){
      for(const pass of selected)await saveVideo('sequence/'+(pass==='scene'?'preview':pass)+'.mp4',stitched[pass],pass);
    }
    if(opt.kind!=='png'&&!completed.length)throw Error(warnings[0]??'No MP4 was produced.');
    files['project.json']=utf(p);
    files['stage.json']=utf(p.stage);
    files['blocking.json']=utf(p.tracks);
    files['shots.json']=utf(shots);
    files['encoding.json']=utf({width:opt.width,height:opt.height,fps:opt.fps,frameCount:count,shots:starts,...passesMetadata,warnings});
    update('Packaging '+(completed.length||count)+' '+(completed.length?'videos':'frames'),98);
    return {zip:zipSync(files,{level:0}),files,completed,warnings};
  } finally {engine.releaseCapture();}
}
