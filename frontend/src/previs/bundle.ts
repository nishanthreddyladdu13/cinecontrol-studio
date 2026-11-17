import { unzipSync, zipSync } from 'fflate';
import { z } from 'zod';
import { projectSchema, type Project } from './project';
import { json, readPrefix, writeCollection, type Media } from './media';

const LIMIT=280*1024*1024;
const metadataShape=z.object({
  key:z.string().min(1).max(400),name:z.string().max(255),path:z.string().regex(/^media\/\d+$/),
  type:z.string().max(120),duration:z.number().optional(),width:z.number().optional(),height:z.number().optional(),fps:z.number().optional(),
});
const manifestShape=z.object({
  kind:z.literal('cinecontrol-project'),version:z.literal(1),projectId:z.string(),
  assets:z.array(metadataShape).max(1500),metadata:z.record(z.string()),
});
const utf=(s:string)=>new TextEncoder().encode(s);
const asJson=(data:Uint8Array|undefined)=>{
  if(!data)throw Error('The bundle is missing a required file.');
  return JSON.parse(new TextDecoder().decode(data));
};

export async function projectBundle(project:Project,bulky:boolean){
  const p=projectSchema.parse(project);
  const assetIds=new Set([p.stage,...(p.stages??[]).map(s=>s.stage)].flatMap(s=>s.objects).concat(p.reusable??[]).flatMap(o=>o.assetId?[o.assetId]:[]));
  const include=(key:string)=>bulky||!(/\/(?:guide-[a-z]+|clip)$/).test(key);
  const groups=await Promise.all([readPrefix(p.id+'/'),...Array.from(assetIds).map(id=>readPrefix('asset/'+id))]);
  const files=Array.from(new Map(groups.flat().filter(([key])=>include(key))).entries());
  if(files.reduce((n,[,m])=>n+m.blob.size,0)>LIMIT)throw Error('Project assets exceed 280 MB. Try exporting without guidance and generated clips.');
  const entries:Record<string,Uint8Array>={'project.json':utf(json(p)),'script.txt':utf(p.script),'stage.json':utf(json(p.stage)),
    'blocking.json':utf(json(p.tracks)),'cameras-and-shots.json':utf(json({cameras:p.cameras,shots:p.shots}))};
  const assets=[];
  for(const [i,[key,m]] of files.entries()){
    const path='media/'+i;entries[path]=new Uint8Array(await m.blob.arrayBuffer());
    const {blob,name,...info}=m;assets.push({key,name,path,type:blob.type,...info});
  }
  const metadata:Record<string,string>={};
  for(let i=0;i<localStorage.length;i++){
    const key=localStorage.key(i);
    if(key?.startsWith(p.id+'/'))metadata[key]=localStorage.getItem(key)??'';
  }
  entries['manifest.json']=utf(json({kind:'cinecontrol-project',version:1,projectId:p.id,assets,metadata}));
  return zipSync(entries,{level:0});
}

export async function openBundle(file:Blob){
  if(file.size>LIMIT+4*1024*1024)throw Error('Project bundle exceeds the browser import limit.');
  let inflated=0;
  const entries=unzipSync(new Uint8Array(await file.arrayBuffer()),{filter:entry=>{
    if(!/^(?:project\.json|manifest\.json|media\/\d+)$/.test(entry.name))return false;
    inflated+=entry.originalSize;
    if(inflated>LIMIT+4*1024*1024)throw Error('The expanded bundle exceeds the browser import limit.');
    return true;
  }});
  const p=projectSchema.parse(asJson(entries['project.json']));
  const m=manifestShape.parse(asJson(entries['manifest.json']));
  if(m.projectId!==p.id)throw Error('The bundle manifest belongs to a different project.');
  const modelIds=new Set([p.stage,...(p.stages??[]).map(s=>s.stage)].flatMap(s=>s.objects).concat(p.reusable??[]).flatMap(o=>o.assetId?[o.assetId]:[]));
  const rows:[string,Media][]=m.assets.map(a=>{
    const data=entries[a.path];
    const allowed=a.key.startsWith(p.id+'/')||[...modelIds].some(id=>a.key==='asset/'+id||a.key.startsWith('asset/'+id+'/'));
    if(!data||!allowed)throw Error('The bundle has a missing or invalid asset.');
    return [a.key,{blob:new Blob([new Uint8Array(data)],{type:a.type}),name:a.name,duration:a.duration,width:a.width,height:a.height,fps:a.fps}];
  });
  await writeCollection(rows);
  for(const [key,value] of Object.entries(m.metadata))if(key.startsWith(p.id+'/'))localStorage.setItem(key,value);
  return p;
}
