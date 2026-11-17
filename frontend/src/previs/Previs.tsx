import { browserMp4Available } from './browser-encoder';
import { type ChangeEvent, type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import {
  Aperture, Box, Camera as CameraIcon, CarFront, Check, ChevronDown, ChevronUp, CircleHelp, Clapperboard, Copy,
  Download, Eye, EyeOff, FileImage, FileText, Focus, FolderOpen, Grid2X2, Layers3, Lock, Maximize2, Minimize2,
  MousePointer2, Move, Pause, Play, Plus, Redo2, Repeat, RotateCw, Save, Scaling, SkipBack, SkipForward,
  Square, TreePine, Trash2, Undo2, Unlock, Upload, Video, Waypoints, X,
} from 'lucide-react';
import {
  actions, activeSequence, activateStage, blankStage, atCut, clamp, collision, cutAt, kinds, makeObject, objectSchema, stageSchema, objectState, orderKeys, passes, presetCamera, presets,
  projectSchema, street, streetScript, total, uid, type Camera, type Key, type StageSequence, type Pass, type Project, type Shot, type StageObject, type V3, type View,
} from './project';
import { importProject } from './legacy';
import { getAsset, libraryAssets, libraryObject } from './scene/catalog';
import { type Generator } from './scene/generators';
import { type SceneReport } from './scene/model';
import { Viewport, type ResultTransform, type Target } from './viewport';
import { download, json, writeMedia } from './media';
import { renderExport, type ExportKind, type Layout } from './export';
import { openBundle, projectBundle } from './bundle';
import { restoreModel, storeModels } from './assets';
import { cameraKey, putMeta, sceneFingerprint, type CameraSlot } from './references';
import { ReferencePanel } from './ReferencePanel';
import { VideoPanel } from './VideoPanel';

const storage='cinecontrol-studio-v3';
const projectsKey=storage+'/projects';
const defaultPlayhead=4.55;
const fmt=(v:number)=>v.toFixed(2);
const titleCase=(v:string)=>v[0].toUpperCase()+v.slice(1);
const localProject=()=>{try{return projectSchema.parse(JSON.parse(localStorage.getItem(storage)??'null'));}catch{return structuredClone(street);}};
const localIndex=():{id:string;title:string}[]=>{try{return JSON.parse(localStorage.getItem(projectsKey)??'[]');}catch{return [];}};
const slug=(v:string)=>v.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||'cinecontrol';
const err=(v:unknown)=>v instanceof Error?v.message:String(v);
type Overlay='script'|'references'|'export'|'video'|'help'|'assets'|null;
type Approval='Unreviewed'|'Approved'|'Needs revision';
const toolModes=[['translate',Move,'Move'],['rotate',RotateCw,'Rotate'],['scale',Scaling,'Scale']] as const;
const stageIcons: Partial<Record<StageObject['kind'],typeof Box>>={car:CarFront,tree:TreePine,character:Waypoints};
function IconButton({label,children,onClick,selected=false,disabled=false}:{label:string;children:ReactNode;onClick:()=>void;selected?:boolean;disabled?:boolean}){
  return <button type="button" title={label} aria-label={label} className={'icon-btn'+(selected?' selected':'')} onClick={onClick} disabled={disabled}>{children}</button>;
}
function Vector({label,value,onChange,disabled=false}:{label:string;value:V3;onChange:(v:V3)=>void;disabled?:boolean}){
  return <div className="vector"><label>{label}</label><div>{(['X','Y','Z'] as const).map((axis,i)=><span key={axis} className={'axis axis-'+axis}><b>{axis}</b>
    <NumberField label={label+' '+axis} value={value[i]} onChange={n=>{const next=[...value] as V3;next[i]=n;onChange(next);}} disabled={disabled}/>
  </span>)}</div></div>;
}
function NumberField({label,value,onChange,min,max,step=.05,disabled=false}:{label:string;value:number;onChange:(n:number)=>void;min?:number;max?:number;step?:number;disabled?:boolean}){
  return <input type="number" step={step} min={min} max={max} aria-label={label} disabled={disabled} key={value}
    defaultValue={Number(value.toFixed(3))} onBlur={e=>{
      const n=e.currentTarget.valueAsNumber;
      if(!Number.isFinite(n)){e.currentTarget.value=String(value);return;}
      const next=clamp(n,min??-10000,max??10000);
      if(next!==value)onChange(next);else e.currentTarget.value=String(value);
    }} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();if(e.key==='Escape'){e.currentTarget.value=String(value);e.currentTarget.blur();}}}/>;
}
function Field({label,children}:{label:string;children:ReactNode}){return <label className="form-field"><span>{label}</span>{children}</label>;}
function FileButton({accept,label,onFile,kind='secondary'}:{accept:string;label:string;onFile:(file:File)=>void;kind?:string}){
  return <label className={'btn '+kind}><Upload size={14}/>{label}<input type="file" accept={accept} onChange={e=>{const f=e.currentTarget.files?.[0];if(f)onFile(f);e.currentTarget.value='';}}/></label>;
}

export function Previs(){
  const [p,setP]=useState(localProject);
  const projectRef=useRef(p);projectRef.current=p;
  const [history,setHistory]=useState<{past:Project[];future:Project[]}>({past:[],future:[]});
  const [saved,setSaved]=useState(()=>localStorage.getItem(storage)??'');
  const [available,setAvailable]=useState(localIndex);
  const [mode,setMode]=useState<View>('blocking');
  const [selected,setSelected]=useState<Target|null>(()=>p.tracks[0]?{kind:'path',id:p.tracks[0].objectId,index:1}:null);
  const [overlay,setOverlay]=useState<Overlay>(null);
  const [time,setTime]=useState(()=>p.id===street.id?defaultPlayhead:0);
  const [playing,setPlaying]=useState(false);
  const [loop,setLoop]=useState(false);
  const [rate,setRate]=useState(1);
  const [pass,setPass]=useState<Pass|'scene'>('scene');
  const [viewMode,setViewMode]=useState<'split'|'world'|'camera'>('split');
  const [view,setView]=useState('Perspective');
  const [transform,setTransform]=useState<typeof toolModes[number][0]>('translate');
  const [snap,setSnap]=useState(false);
  const [grid,setGrid]=useState(true);
  const [axes,setAxes]=useState(false);
  const [collapsed,setCollapsed]=useState({left:false,right:false,timeline:false});
  const [notice,setNotice]=useState('');
  const [engineError,setEngineError]=useState('');
  const [ready,setReady]=useState(false);
  const [objectKind,setObjectKind]=useState<StageObject['kind']>('box');
  const [sceneText,setSceneText]=useState('');
  const [sceneError,setSceneError]=useState('');
  const [sceneBusy,setSceneBusy]=useState('');
  const sceneBusyRef=useRef(false);
  const [catalogSelection,setCatalogSelection]=useState('metal-lantern');
  const [prefab,setPrefab]=useState<Generator>('building');
  const [draft,setDraft]=useState<Project|null>(null);
  const [draftText,setDraftText]=useState('');
  const [draftScope,setDraftScope]=useState<'all'|'stage'|'blocking'|'cameras'>('all');
  const [script,setScript]=useState(p.script);
  const [pending,setPending]=useState(false);
  const [sourceSize,setSourceSize]=useState('480x854');
  const [layout,setLayout]=useState<Layout>('separate');
  const [capabilities,setCapabilities]=useState<{mp4:boolean;seedance:boolean;image:boolean}>({mp4:false,seedance:false,image:false});
  const [exportNote,setExportNote]=useState('');
  const [exportFiles,setExportFiles]=useState<{zip:Uint8Array;filename:string;files:Record<string,Uint8Array>;completed:{name:string;filesize:number}[]}|null>(null);
  const [includeBulky,setIncludeBulky]=useState(true);
  const [bundleBusy,setBundleBusy]=useState(false);
  const [timelineSnap,setTimelineSnap]=useState(true);
  const [dragging,setDragging]=useState<{id:string;index:number;position:number}|null>(null);
  const keyDrag=useRef<{x:number;position:number;moved:boolean}|null>(null);
  const [newStageName,setNewStageName]=useState('');
  const [assetBusy,setAssetBusy]=useState(false);
  const [exportFps,setExportFps]=useState(p.fps);
  const [exportAll,setExportAll]=useState(false);
  const [exportStart,setExportStart]=useState(0);
  const [exportEnd,setExportEnd]=useState(0);
  const [exportPasses,setExportPasses]=useState<Pass[]>([...passes]);
  const [progress,setProgress]=useState<number|null>(null);
  const [approval,setApproval]=useState<Approval>('Unreviewed');
  const [reviewAll,setReviewAll]=useState(false);
  const [reviewFrame,setReviewFrame]=useState('');
  const [mediaVersion,setMediaVersion]=useState(0);
  const [seekOnly,setSeekOnly]=useState(false);
  const [wasSaved,setWasSaved]=useState(false);
  const leftPane=useRef<HTMLDivElement>(null);
  const worldPane=useRef<HTMLDivElement>(null);
  const cameraPane=useRef<HTMLDivElement>(null);
  const timelinePane=useRef<HTMLElement>(null);
  const root=useRef<HTMLDivElement>(null);
  const viewport=useRef<Viewport|null>(null);
  const editFn=useRef<(target:Target,value:ResultTransform)=>void>(()=>{});
  const noticeTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const where=atCut(p,clamp(time,0,total(p)));
  const shot=where.shot;
  const camera=p.cameras.find(c=>c.id===shot.cameraId)!;
  const object=selected?p.stage.objects.find(o=>o.id===selected.id):undefined;
  const track=object?p.tracks.find(t=>t.objectId===object.id):undefined;
  const activeKey=selected?.kind==='path'?selected.index??0:0;
  const dirty=JSON.stringify(p)!==saved;
  const overlap=mode==='blocking'?collision(p,where.time):'';
  const seq=total(p);
  const stage=activeSequence(p);
  const editableKey=track?.keys[activeKey];
  const refresh=()=>setMediaVersion(v=>v+1);

  function status(message:string){
    setNotice(message);
    if(noticeTimer.current)clearTimeout(noticeTimer.current);
    noticeTimer.current=setTimeout(()=>setNotice(''),4800);
  }
  function commit(transform:(next:Project)=>void){
    const previous=projectRef.current;
    const next=structuredClone(previous);
    transform(next);
    const parsed=projectSchema.safeParse(next);
    if(!parsed.success){status(parsed.error.issues[0]?.message||'Invalid project data.');return false;}
    if(JSON.stringify(parsed.data)===JSON.stringify(previous))return true;
    projectRef.current=parsed.data;
    setHistory(h=>({past:[...h.past.slice(-39),previous],future:[]}));
    setP(parsed.data);
    return true;
  }
  function load(next:Project,silent=false){
    setSceneError('');
    const previous=projectRef.current;
    setHistory(h=>({past:[...h.past.slice(-39),previous],future:[]}));
    projectRef.current=next;setP(next);
    setScript(next.script);setPlaying(false);setTime(0);setOverlay(null);setSelected(null);
    if(!silent)status('Opened '+next.title);
  }
  function undo(){
    if(!history.past.length)return;
    const next=history.past.at(-1)!;
    setHistory({past:history.past.slice(0,-1),future:[p,...history.future]});setP(next);setScript(next.script);
  }
  function redo(){
    if(!history.future.length)return;
    const next=history.future[0];
    setHistory({past:[...history.past,p],future:history.future.slice(1)});setP(next);setScript(next.script);
  }
  function save(){
    const p=projectRef.current;
    try{
      localStorage.setItem(storage,JSON.stringify(p));
      localStorage.setItem(projectsKey+'/'+p.id,JSON.stringify(p));
      const list=[{id:p.id,title:p.title},...available.filter(i=>i.id!==p.id)];
      localStorage.setItem(projectsKey,JSON.stringify(list));
      setSaved(JSON.stringify(p));setAvailable(list);setWasSaved(true);status('Project saved in this browser.');
    }catch(error){status(err(error));}
  }
  function objectChange(id:string,change:Partial<StageObject>){
    return commit(q=>Object.assign(q.stage.objects.find(o=>o.id===id)!,change));
  }
  function cameraChange(id:string,change:Partial<Camera>){
    return commit(q=>Object.assign(q.cameras.find(c=>c.id===id)!,change));
  }
  function shotChange(id:string,change:Partial<Shot>){
    return commit(q=>Object.assign(q.shots.find(s=>s.id===id)!,change));
  }
  function chooseShot(index:number,reset=true){
    const row=p.shots[index];if(!row)return;
    setPlaying(false);
    if(reset)setTime(cutAt(p,index));
    setSelected({kind:'camera',id:row.cameraId});
  }
  function switchMode(next:View){
    setOverlay(null);setMode(next);
    if(next==='cameras')setSelected({kind:'camera',id:camera.id});
    else if(next==='stage')setSelected(object?{kind:'object',id:object.id}:null);
    else if(p.tracks[0]&&selected?.kind!=='path')setSelected({kind:'path',id:p.tracks[0].objectId,index:0});
  }
  function keyChange(objectId:string,index:number,change:Partial<Key>){
    if(p.stage.objects.find(o=>o.id===objectId)?.locked)return;
    const current=p.tracks.find(t=>t.objectId===objectId);
    const key=current?.keys[index];
    if(!key)return;
    if(change.time!==undefined&&current.keys.some((v,i)=>i!==index&&v.time===change.time)){status('A keyframe already exists at this time.');return;}
    const next={...key,...change};
    const keys=orderKeys(current.keys.map((v,i)=>i===index?next:v));
    if(commit(q=>{q.tracks.find(t=>t.objectId===objectId)!.keys=keys;})){
      setSelected({kind:'path', id:objectId,index:keys.indexOf(next)});
    }
  }
  function addKey(id:string){
    const o=p.stage.objects.find(i=>i.id===id);if(!o||o.locked)return;
    const old=p.tracks.find(r=>r.objectId===id);
    const now=timelineSnap?Math.round(where.time*p.fps)/p.fps:Number(where.time.toFixed(3));
    if(old?.keys.some(k=>k.time===now)){status('A keyframe already exists at this time.');return;}
    const sample=objectState(o,old,now);
    const keys=orderKeys([...(old?.keys??[]),{time:now,position:sample.position,rotation:sample.rotation}]);
    if(commit(q=>{
      const t=q.tracks.find(i=>i.objectId===id);
      if(t)t.keys=keys;else q.tracks.push({objectId:id,action:o.kind==='car'?'drive':'walk',keys});
    }))setSelected({kind:'path',id,index:keys.findIndex(k=>k.time===now)});
  }
  editFn.current=(target,v)=>{
    if(target.kind==='object')objectChange(target.id,v);
    if(target.kind==='path')keyChange(target.id,target.index??0,{position:v.position});
    if(target.kind==='camera')cameraChange(target.id,{position:v.position});
  };

  useEffect(()=>{
    if(!worldPane.current||!cameraPane.current)return;
    let instance:Viewport;
    try{instance=new Viewport(worldPane.current,cameraPane.current);}
    catch(error){setEngineError('The 3D preview could not start. '+err(error));return;}
    viewport.current=instance;
    instance.onPick=setSelected;
    instance.onTransform=(target,value)=>editFn.current(target,value);
    setReady(true);
    return ()=>{instance.destroy();viewport.current=null;};
  },[]);
  useEffect(()=>{viewport.current?.configure(p);},[p,ready]);
  useEffect(()=>{viewport.current?.setMode(mode);},[mode,ready]);
  useEffect(()=>{viewport.current?.setSelection(selected);},[selected,mode,p,ready]);
  useEffect(()=>{viewport.current?.setTransform(transform,snap);},[transform,snap,mode,selected,ready]);
  useEffect(()=>{viewport.current?.view(view);},[view,ready]);
  useEffect(()=>{if(viewport.current){viewport.current.grid.visible=grid;viewport.current.axes.visible=axes;viewport.current.invalidate();}},[grid,axes,ready]);
  useEffect(()=>{viewport.current?.show(shot,where.time,pass);},[shot,where.time,pass,p,ready]);
  const assetIds=p.stage.objects.map(o=>o.assetId).filter(Boolean).join(',');
  useEffect(()=>{
    const engine=viewport.current;if(!engine||!assetIds)return;
    let cancelled=false;
    for(const id of new Set(assetIds.split(',')))if(!engine.assets.has(id)) {
      void restoreModel(engine,id).catch(error=>{if(!cancelled)status(err(error));});
    }
    return ()=>{cancelled=true;};
  },[assetIds,ready]);
  useEffect(()=>{
    if(!playing)return;
    let frame=0,last=performance.now();
    const step=(now:number)=>{
      const dt=Math.min(.1,(now-last)/1000)*rate;last=now;
      setTime(old=>{
        const bounds=seekOnly?where.cut+shot.duration:seq;
        const beginning=seekOnly?where.cut:0;
        if(old+dt>=bounds){
          if(loop)return beginning;
          queueMicrotask(()=>setPlaying(false));
          return seekOnly?Math.max(beginning,bounds-.00001):bounds;
        }
        return old+dt;
      });
      frame=requestAnimationFrame(step);
    };
    frame=requestAnimationFrame(step);
    return ()=>cancelAnimationFrame(frame);
  },[playing,rate,loop,seq,seekOnly,seekOnly?shot.id:'']);
  useEffect(()=>{
    const before=(e:BeforeUnloadEvent)=>{if(dirty&&(history.past.length>0||wasSaved))e.preventDefault();};
    window.addEventListener('beforeunload',before);return ()=>window.removeEventListener('beforeunload',before);
  },[dirty,history.past.length,wasSaved]);
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{
      if((e.target as HTMLElement)?.matches('input,textarea,select,[contenteditable]'))return;
      if(e.key==='Escape'){if(progress===null)setOverlay(null);return;}
      if(overlay)return;
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();save();return;}
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();if(e.shiftKey)redo();else undo();return;}
      if(e.code==='Space'&&!(e.target as HTMLElement)?.closest('button')){e.preventDefault();setPlaying(v=>!v);}
      if(e.key==='Delete'&&object&&selected?.kind==='path'){e.preventDefault();deleteKey(object,activeKey);}
      if(e.key==='ArrowLeft'||e.key==='ArrowRight')setTime(t=>clamp(t+(e.key==='ArrowLeft'?-1:1)/p.fps,0,seq));
      if(e.key==='1')switchMode('stage');if(e.key==='2')switchMode('blocking');if(e.key==='3')switchMode('cameras');
    };
    window.addEventListener('keydown',key);return ()=>window.removeEventListener('keydown',key);
  });
  
useEffect(() => {
  if (!overlay || !['export', 'references', 'video'].includes(overlay)) {
    return;
  }

  const abort = new AbortController();

  const [width, height] = sourceSize.split('x').map(Number);

  void Promise.all([
    browserMp4Available(width, height, exportFps),

    fetch('/api/previs/capabilities', {
      signal: abort.signal,
    })
      .then(response => response.ok ? response.json() : null)
      .catch(() => null),

  ]).then(([browserSupported, backend]) => {
    if (abort.signal.aborted) return;

    setCapabilities({
      mp4: browserSupported || Boolean(backend?.mp4),
      seedance: Boolean(backend?.seedance),
      image: Boolean(backend?.image),
    });
  });

  return () => abort.abort();
}, [overlay, sourceSize, exportFps]);


  useEffect(()=>{
    if(overlay!=='video'||!viewport.current)return;
    const engine=viewport.current;
    let cancelled=false;
    const scheduled=requestAnimationFrame(()=>{
      if(cancelled)return;
      try{setReviewFrame(engine.capture(shot,where.time,180,320,['scene']).frames.scene);}
      catch(error){status(err(error));}
      finally{engine.releaseCapture();}
    });
    return ()=>{cancelled=true;cancelAnimationFrame(scheduled);};
  },[overlay,shot.id,where.time,p,ready]);

  async function readImportedScene(value:unknown){
    if(sceneBusyRef.current)return;
    if(!value||typeof value!=='object'||!Object.hasOwn(value,'sceneFormat')){
      load(importProject(value));
      return;
    }
    sceneBusyRef.current=true;setSceneBusy('Validating scene…');setSceneError('');
    try{
      const {buildScene}=await import('./scene/orchestrator');
      const next=await buildScene(value,setSceneBusy);
      const engine=viewport.current;
      const builtins=[...new Set(next.stage.objects.map(o=>o.assetId).filter((id):id is string=>Boolean(id&&getAsset(id))))];
      if(engine&&builtins.length){
        setSceneBusy('Loading local models…');
        const loaded=await Promise.allSettled(builtins.map(id=>engine.loadBuiltin(id)));
        for(const [i,row] of loaded.entries())if(row.status==='rejected'){
          const report=next.sceneReport!;
          const affected=[next,...(next.stages??[])].flatMap(s=>s.stage.objects).filter(o=>o.assetId===builtins[i]);
          report.exact-=affected.length;report.proxies+=affected.length;
          if(report.warnings.length===300)report.warnings.pop();
          report.warnings.push('Model '+builtins[i]+' could not load. Objects using it appear as proxies.');
          for(const object of affected){object.source='proxy';object.assetId=undefined;object.modelClip=undefined;}
        }
      }
      load(next,true);setSceneText('');setMode('stage');
      status('Opened '+next.title+'. '+next.sceneReport!.warnings.length+' diagnostics in the Scene import report.');
    }catch(error){setSceneError(err(error));status('Scene import failed. Review the validation details.');}
    finally{sceneBusyRef.current=false;setSceneBusy('');}
  }
  async function applyFile(file:File){
    try{
      if(/\.zip$/i.test(file.name)){load(await openBundle(file));refresh();return;}
      if(!file.name.toLowerCase().endsWith('.json')){
        setScript(await file.text());setDraft(null);setOverlay('script');return;
      }
      if(file.size>4*1024*1024)throw Error('Scene JSON exceeds the 4 MB import limit.');
      await readImportedScene(JSON.parse(await file.text()));
    }catch(error){setSceneError(err(error));status('Import failed. '+err(error));}
  }
  async function generate(){
    if(script.trim().length<12){status('Enter at least 12 characters of scene description.');return;}
    setPending(true);setDraft(null);
    try{
      const response=await fetch('/api/previs/draft',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({script,scope:draftScope,...(draftScope==='all'?{}:{current:p})}),signal:AbortSignal.timeout(130_000)});
      const data=await response.json().catch(()=>null);
      if(!response.ok)throw Error(typeof data?.detail==='string'?data.detail:'Run the FastAPI server and configure your model in backend/.env.');
      const next=projectSchema.parse(data);
      if(draftScope==='all')next.id=uid();setDraft(next);setDraftText(json(next));
    }catch(error){status(err(error));}finally{setPending(false);}
  }
  function applyDraft(){
    try{
      const parsed=projectSchema.parse(JSON.parse(draftText));
      if(parsed.id===p.id){const {stage,tracks,cameras,shots,script}=parsed;if(!commit(q=>Object.assign(q,{stage,tracks,cameras,shots,script})))return;setOverlay(null);status('Scene draft applied.');}
      else load(parsed);
      setDraft(null);
    } catch(error){status('Draft validation failed. '+err(error));}
  }
  function changeDraft(update:(d:Project)=>void){
    try{const d=projectSchema.parse(JSON.parse(draftText));update(d);const validated=projectSchema.parse(d);setDraft(validated);setDraftText(json(validated));}
    catch(error){status(err(error));}
  }
  async function loadSceneSample(){
    try{
      const response=await fetch(import.meta.env.BASE_URL+'scene-kit/examples/observatory.json');
      if(!response.ok)throw Error('Sample scene is unavailable.');
      await readImportedScene(await response.json());
    }catch(error){status(err(error));}
  }
  async function exportSceneKit(){
    try{
      const {sceneKit}=await import('./scene/kit');
      download('CineControl_ChatGPT_Scene_Generator_Kit.zip',await sceneKit());
    }catch(error){status(err(error));}
  }
  async function placeCatalogModel(){
    const engine=viewport.current,asset=getAsset(catalogSelection),stageId=activeSequence(projectRef.current).id;
    if(!engine||!asset||assetBusy)return;
    setAssetBusy(true);
    try{
      await engine.loadBuiltin(asset.id);
      if(activeSequence(projectRef.current).id!==stageId)throw Error('The active stage changed before the model finished loading.');
      const item=objectSchema.parse(libraryObject(asset,uid(),[0,0,0]));
      if(commit(q=>q.stage.objects.push(item))){setSelected({kind:'object',id:item.id});setMode('stage');setOverlay(null);}
    }catch(error){status(err(error));}finally{setAssetBusy(false);}
  }
  async function placePrefab(){
    try{
      const {buildScene}=await import('./scene/orchestrator');
      const id=uid(), stageId=activeSequence(projectRef.current).id;
      const name=titleCase(prefab);
      const built=await buildScene({sceneFormat:'cinecontrol.scene/1',id:'prefab',title:name,stages:[{id:'stage',name,bounds:p.stage.bounds,objects:[{id,name,generator:prefab}]}]});
      if(activeSequence(projectRef.current).id!==stageId)throw Error('The active stage changed before the prefab finished building.');
      if(commit(q=>q.stage.objects.push(built.stage.objects[0]))){setSelected({kind:'object',id});setMode('stage');setOverlay(null);}
    }catch(error){status(err(error));}
  }
  function addObject(){
    const item=makeObject(objectKind);
    if(commit(q=>q.stage.objects.push(item)))setSelected({kind:'object',id:item.id});
  }
  function addCharacter(){
    let name='Character '+(p.stage.objects.filter(o=>o.kind==='character').length+1);
    while(p.stage.objects.some(o=>o.name===name))name+=' copy';
    const o={...makeObject('character',name),size:[.62,1.75,.48] as V3,position:[1,0,1] as V3,color:'#85a8c7'};
    if(commit(q=>q.stage.objects.push(o))){setSelected({kind:'object',id:o.id});setMode('blocking');}
  }
  async function importAssets(files:File[],pos:V3=[0,0,0],replace?:string){
    const engine=viewport.current;
    if(!engine||assetBusy)return;
    setAssetBusy(true);
    try{
      const imported=await storeModels(engine,files);
      if(replace){
        if(imported.length!==1)throw Error('Choose one replacement model.');
        const target=projectRef.current.stage.objects.find(o=>o.id===replace);
        if(!target)throw Error('Reopen the stage containing the object to replace.');
        objectChange(replace,{assetId:imported[0].id,kind:target.kind==='character'?'character':'asset',model:undefined,modelClip:undefined,source:undefined});
        return;
      }
      const objects=imported.map((entry,i)=>({...makeObject('asset',entry.name),assetId:entry.id,size:entry.size,position:[pos[0]+i,pos[1],pos[2]] as V3}));
      if(commit(q=>q.stage.objects.push(...objects))){setSelected({kind:'object',id:objects[0].id});setMode('stage');setOverlay(null);status('Imported '+objects.length+' independent model'+(objects.length===1?'':'s')+'.');}
    }catch(error){status('Model import failed. '+err(error));}finally{setAssetBusy(false);}
  }
  function switchStage(sequence:StageSequence){
    if(commit(q=>activateStage(q,structuredClone(sequence)))){setTime(0);setSelected(null);setPlaying(false);setMode('stage');}
  }
  function duplicateStage(){
    const current=structuredClone(activeSequence(projectRef.current));
    current.id=uid();current.name=(current.name+' copy').slice(0,100);
    current.shots=current.shots.map(shot=>({...shot,id:uid()}));
    switchStage(current);
  }
  async function openStageSequence(file:File,replace:boolean){
    try{
      if(file.size>4*1024*1024)throw Error('Stage JSON exceeds 4 MB.');
      const raw=JSON.parse(await file.text());
      let imported:StageSequence;
      if(raw&&typeof raw==='object'&&Object.hasOwn(raw,'sceneFormat')){
        const {buildScene}=await import('./scene/orchestrator');
        imported=activeSequence(await buildScene(raw));
      }else if(raw?.kind==='cinecontrol-stage'&&raw.version===1){
        imported=activeSequence(projectSchema.parse({version:3,id:'stage-import',title:'Stage import',script:'',fps:24,
          stageId:raw.stage?.id,stageName:raw.stage?.name,stage:raw.stage?.stage,tracks:raw.stage?.tracks,cameras:raw.stage?.cameras,shots:raw.stage?.shots}));
      }else throw Error('Choose a CineControl stage file or scene description JSON.');
      const view=viewport.current;
      const ids=new Set(imported.stage.objects.flatMap(o=>o.assetId?[o.assetId]:[]));
      for(const id of ids)if(view&&!view.assets.has(id)){
        await restoreModel(view,id);
        if(!view.assets.has(id))throw Error('Missing local model '+id+'. Import a portable project bundle containing the model first.');
      }
      const accepted=commit(q=>{
        const used=new Set([...(q.stages??[]).flatMap(s=>s.shots),...(replace?[]:q.shots)].map(shot=>shot.id));
        imported.shots=imported.shots.map(shot=>used.has(shot.id)?{...shot,id:uid()}:shot);
        if(replace){
          q.stageName=imported.name;q.stage=imported.stage;q.tracks=imported.tracks;
          q.cameras=imported.cameras;q.shots=imported.shots;
        }else{
          const stages=[activeSequence(q),...(q.stages??[])];
          if(stages.some(stage=>stage.id===imported.id))imported.id=uid();
          activateStage(q,imported);
        }
      });
      if(accepted){setTime(0);setPlaying(false);setSelected(null);setMode('stage');setOverlay(null);status('Opened stage '+imported.name);}
    }catch(error){status('Stage import failed. '+err(error));}
  }
  function createStage(){
    const name=newStageName.trim();
    if(!name){status('Enter a stage name.');return;}
    switchStage(blankStage(name));setNewStageName('');
  }
  async function importStage(file:File){
    try{
      const raw=JSON.parse(await file.text());
      const imported=stageSchema.safeParse(raw.stage??raw);
      if(imported.success){
        const used = new Set(p.stage.objects.map(o=>o.id));
        const objects=imported.data.objects.map(o=>({...o,id:used.has(o.id)?uid():o.id}));
        for(const o of objects)if(o.assetId&&!getAsset(o.assetId)&&!viewport.current?.assets.has(o.assetId)){status('Use a complete project bundle to restore this stage’s linked model files.');return;}
        if(commit(q=>{q.stage.objects.push(...objects);}))status('Added '+objects.length+' independent stage objects.');
      }else throw Error('Choose a stage JSON or a complete project ZIP.');
    }catch(error){status('Stage import failed. '+err(error));}
  }
  function saveReusable(o:StageObject){
    if(commit(q=>{q.reusable=[...(q.reusable??[]),{...structuredClone(o),id:uid(),identityId:o.kind==='character'?(o.identityId??o.id):o.identityId}];}))status('Added '+o.name+' to reusable objects.');
  }
  function placeReusable(id:string,position:V3){
    const object=p.reusable?.find(o=>o.id===id);
    if(!object)return;
    const next={...structuredClone(object),id:uid(),position,locked:false};
    if(commit(q=>q.stage.objects.push(next))){setSelected({kind:'object',id:next.id});setOverlay(null);setMode('stage');}
  }
  function duplicateObject(o:StageObject){
    const copy={...structuredClone(o),id:uid(),name:(o.name+' copy').slice(0,100),position:[o.position[0]+1,o.position[1],o.position[2]+1] as V3};
    if(commit(q=>q.stage.objects.push(copy)))setSelected({kind:'object',id:copy.id});
  }
  function removeObject(o:StageObject){
    if(o.locked)return;
    if(commit(q=>{
      q.stage.objects=q.stage.objects.filter(v=>v.id!==o.id);
      q.tracks=q.tracks.filter(t=>t.objectId!==o.id);
      q.cameras=q.cameras.map(c=>c.actorId===o.id?{...c,actorId:undefined}:c);
    }))setSelected(null);
  }
  function editShot(action:'add'|'duplicate'|'delete'|'earlier'|'later'){
    if(action==='add'||action==='duplicate'){
      const id=uid(), camId=uid(), index=action==='add'?p.shots.length:where.index+1;
      const source=action==='add'?shot.start+shot.duration:shot.start;
      const name=action==='add'?'New shot':(shot.name+' copy').slice(0,100);
      if(commit(q=>{
        q.cameras.push({...structuredClone(camera),id:camId,name});
        q.shots.splice(index,0,{...shot,id,cameraId:camId,name,start:source});
      })){
        setTime(action==='add'?seq:where.cut+shot.duration);setSelected({kind:'camera',id:camId});setMode('cameras');
      }
    }else if(action==='delete'&&p.shots.length>1){
      if(commit(q=>{
        q.shots.splice(where.index,1);
        if(!q.shots.some(s=>s.cameraId===camera.id))q.cameras=q.cameras.filter(c=>c.id!==camera.id);
      })){setSelected(null);setTime(Math.min(time,seq-shot.duration));}
    }else if(action==='earlier'||action==='later'){
      const i=where.index+(action==='earlier'?-1:1);
      if(i<0||i>=p.shots.length)return;
      const newCut=action==='earlier'?cutAt(p,i):where.cut+p.shots[i].duration;
      if(commit(q=>{[q.shots[where.index],q.shots[i]]=[q.shots[i],q.shots[where.index]];}))setTime(newCut);
    }
  }
  function pickTarget(target:Target| null){
    setSelected(target);
    if(target?.kind==='camera'){
      const i=p.shots.findIndex(s=>s.cameraId===target.id);
      if(i>=0&&i!==where.index)chooseShot(i);
    }
  }
  useEffect(()=>{if(viewport.current)viewport.current.onPick=pickTarget;});
  async function capture(slot:CameraSlot){
    const engine=viewport.current;
    if(!engine)throw Error('Start the 3D preview first.');
    const dt=slot==='opening'?0:slot==='ending'?Math.max(0,shot.duration-1/p.fps):where.local;
    const t=shot.start+dt,key=cameraKey(p,shot,slot);
    try {
      const result=engine.capture(shot,t,576,1024,['scene']);
      const blob=await fetch(result.frames.scene).then(r=>r.blob());
      await writeMedia(key,{blob,name:slug(shot.name)+'-3d-'+slot+'.png',width:576,height:1024});
      putMeta(key,{fingerprint:sceneFingerprint(p,shot),time:t});refresh();status('Captured '+slot+' 3D camera frame.');
    } finally{engine.releaseCapture();}
  }
  async function startExport(kind:ExportKind){
    const engine=viewport.current;
    if(!engine){status('Start the 3D preview before rendering exports.');return;}
    if(kind!=='png'&&!capabilities.mp4){status('Install the updated backend requirements and restart.');return;}
    if(kind!=='preview'&&!exportPasses.length){status('Choose at least one guidance pass.');return;}
    setPlaying(false);setProgress(0);setExportNote('Starting export…');setExportFiles(null);
    const [width,height]=sourceSize.split('x').map(Number);
    try{
      const ids=[...new Set(p.stage.objects.flatMap(o=>o.assetId&&getAsset(o.assetId)?[o.assetId]:[]))];
      await Promise.all(ids.map(id=>engine.loadBuiltin(id)));
      const out=await renderExport(engine,p,exportAll?p.shots:[shot],{
        width,height,fps:exportFps,start:exportStart,end:exportEnd,passes:exportPasses,kind,layout,
      },(label,n)=>{setProgress(n);setExportNote(label);});
      const filename=slug(p.title)+(exportAll?'':'-'+slug(shot.name))+'-'+kind+'.zip';
      setExportFiles({...out,filename});download(filename,out.zip);refresh();
      setExportNote(out.warnings.length?out.warnings.join(' · '):kind==='png'?'PNG sequences are ready.':out.completed.length+' MP4 files are ready.');
    }catch(error){setExportNote(err(error));status(err(error));}
    finally{setProgress(null);}
  }
  async function saveBundle(){
    setBundleBusy(true);
    try{download(slug(p.title)+'-project.zip',await projectBundle(p,includeBulky));status('Portable project exported.');}
    catch(error){status(err(error));}
    finally{setBundleBusy(false);}
  }
  function changeApproval(value:Approval){
    localStorage.setItem(p.id+'/'+shot.id+'/approval',value);setApproval(value);
  }
  function resizePanel(e:React.PointerEvent<HTMLElement>,which:'left'|'right'|'timeline'){
    const el=root.current;if(!el)return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const start=which==='timeline'?e.clientY:e.clientX;
    const width=which==='left'?leftPane.current?.offsetWidth:which==='timeline'?timelinePane.current?.offsetHeight:document.querySelector('.inspector')?.clientWidth;
    e.currentTarget.onpointermove=ev=>{
      const at=which==='timeline'?ev.clientY:ev.clientX;
      const adjust=which==='left'?at-start:start-at;
      el.style.setProperty('--'+which,clamp((width??240)+adjust,which==='timeline'?150:170,which==='timeline'?370:430)+'px');
    };
    e.currentTarget.onpointerup=()=>{e.currentTarget.onpointermove=null;e.currentTarget.onpointerup=null;};
  }
  function scrub(e:React.PointerEvent<HTMLDivElement>){
    if((e.target as HTMLElement).closest('button'))return;
    const node=e.currentTarget;node.setPointerCapture(e.pointerId);setPlaying(false);
    const move=(x:number)=>{const bounds=node.getBoundingClientRect();setTime(clamp((x-bounds.left)/bounds.width*seq,0,seq));};
    move(e.clientX);
    node.onpointermove=event=>move(event.clientX);
    node.onpointerup=()=>{node.onpointermove=null;node.onpointerup=null;};
  }
  const visibleObjects=mode==='blocking' ? p.stage.objects.filter(o=>o.kind==='character'||o.kind==='car'||p.tracks.some(t=>t.objectId===o.id)) : p.stage.objects;
  const objectGroups=[...new Set(visibleObjects.map(o=>mode==='stage'?o.group:''))];
  function timelineKey(t:number){
    for(const [i,s] of p.shots.entries())if(t>=s.start&&t<=s.start+s.duration){return cutAt(p,i)+t-s.start;}
    return null;
  }
  function deleteKey(o:StageObject,index:number){
    const t=p.tracks.find(t=>t.objectId===o.id);
    if(o.locked||!t||t.keys.length<2)return;
    if(commit(q=>{q.tracks.find(t=>t.objectId===o.id)!.keys.splice(index,1);})){
      setSelected({kind:'path',id:o.id,index:Math.max(0,index-1)});
    }
  }
  function duplicateKey(){
    if(!object||object.locked||!track||!editableKey)return;
    let t=where.time>editableKey.time?where.time:editableKey.time+1/p.fps;
    if(timelineSnap)t=Math.round(t*p.fps)/p.fps;
    while(track.keys.some(k=>Math.abs(k.time-t)<.000001))t+=1/p.fps;
    if(t>600){status('Timeline limit reached.');return;}
    const key={...editableKey,time:t},keys=orderKeys([...track.keys,key]);
    if(commit(q=>{q.tracks.find(v=>v.objectId===object.id)!.keys=keys;}))setSelected({kind:'path',id:object.id,index:keys.indexOf(key)});
  }
  function selectKey(id:string,index:number,displayTime:number,cameraKey=false){
    setPlaying(false);setTime(displayTime);
    setMode(cameraKey?'cameras':'blocking');setSelected(cameraKey?{kind:'camera',id,index}:{kind:'path',id,index});
  }
  function dragKey(e:React.PointerEvent<HTMLButtonElement>,id:string,index:number,original:number,isCamera=false){
    if(e.button!==0)return;
    e.stopPropagation();
    selectKey(id,index,original,isCamera);
    if(!isCamera&&p.stage.objects.find(o=>o.id===id)?.locked)return;
    e.currentTarget.setPointerCapture(e.pointerId);
    keyDrag.current={x:e.clientX,position:original,moved:false};
  }
  function moveKey(e:React.PointerEvent<HTMLButtonElement>,id:string,index:number,isCamera=false){
    const drag=keyDrag.current;if(!drag||!e.currentTarget.hasPointerCapture(e.pointerId))return;
    if(Math.abs(e.clientX-drag.x)<3&&!drag.moved)return;
    const bounds=e.currentTarget.closest('.time-area')!.getBoundingClientRect();
    let display=clamp(drag.position+(e.clientX-drag.x)/bounds.width*seq,0,seq);
    if(timelineSnap){
      const cut=atCut(p,display);
      const value=Math.round(cut.time*p.fps)/p.fps;
      display=clamp(cut.cut+value-cut.shot.start,cut.cut,cut.cut+cut.shot.duration);
      const candidates=[...p.tracks.flatMap(t=>t.keys.filter((_,i)=>isCamera||t.objectId!==id||i!==index)),...p.cameras.flatMap(c=>c.keys.filter((_,i)=>!isCamera||c.id!==id||i!==index))];
      for(const k of candidates){
        const at=timelineKey(k.time);
        if(at!==null&&Math.abs(at-display)*bounds.width/seq<5){display=at;break;}
      }
    }
    drag.moved=true;setDragging({id,index,position:display});setTime(display);
  }
  function releaseKey(e:React.PointerEvent<HTMLButtonElement>,id:string,index:number,isCamera=false){
    const drag=keyDrag.current;
    if(drag?.moved&&dragging){
      const t=atCut(p,dragging.position).time;
      if(isCamera){
        const cam=p.cameras.find(c=>c.id===id);
        if(cam?.keys.some((k,i)=>i!==index&&Math.abs(k.time-t)<.000001))status('This camera already has a keyframe at that time.');
        else if(cam)cameraChange(id,{keys:orderKeys(cam.keys.map((k,i)=>i===index?{...k,time:t}:k))});
      }else keyChange(id,index,{time:t});
    }
    keyDrag.current=null;setDragging(null);
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
  }
  function keyButton(id:string,index:number,position:number,time:number,label:string,isCamera=false){
    return <button key={time} className={'diamond'+(selected?.id===id&&selected?.index===index?' active-diamond':'')} style={mark(dragging?.id===id&&dragging.index===index?dragging.position:position)}
      aria-label={label} title={fmt(time)+' s · drag to retime'} onPointerDown={e=>dragKey(e,id,index,position,isCamera)}
      onPointerMove={e=>moveKey(e,id,index,isCamera)} onPointerUp={e=>releaseKey(e,id,index,isCamera)}
      onPointerCancel={()=>{keyDrag.current=null;setDragging(null);}} onClick={e=>{if(e.detail===0)selectKey(id,index,position,isCamera);}}/>;
  }
  const ticks=Array.from({length:Math.min(15,Math.floor(seq/2)+1)},(_,i)=>Math.min(seq,i*(seq>28?Math.ceil(seq/14):2)));
  const mark=(pos:number):CSSProperties=>({left:(pos/seq*100)+'%'});
  const tab=(text:string,active:boolean,handler:()=>void,icon:ReactNode,extra='')=><button className={'tab '+(active?'active ':'')+extra} onClick={handler}>{icon}<span>{text}</span></button>;
  const changedTitle=(e:ChangeEvent<HTMLInputElement>)=>{const value=e.currentTarget.value.trim();if(value&&value!==p.title)commit(q=>{q.title=value;});};
  return <div className={'studio '+(collapsed.left?'hide-left ':'')+(collapsed.right?'hide-right ':'')+(collapsed.timeline?'hide-timeline ':'')} ref={root}>
    <header className="header">
      <div className="product">
        <span className="product-icon"><Aperture size={21}/></span><b>CineControl</b>
        <span className="divider"/><select aria-label="Open saved project" value="" onChange={e=>{
          const saved=localStorage.getItem(projectsKey+'/'+e.target.value);
          if(saved)try{load(projectSchema.parse(JSON.parse(saved)));}catch(error){status(err(error));}
        }}><option value="">{p.title}</option>{available.filter(i=>i.id!==p.id).map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select>
      </div>
      <div className="header-actions">
        <span className="saved"><i className={dirty&&history.past.length?'dirty':''}/>{dirty&&history.past.length?'Unsaved edits':saved?'Saved locally':'Demo project'}</span>
        <IconButton label="Undo" disabled={!history.past.length} onClick={undo}><Undo2 size={16}/></IconButton>
        <IconButton label="Redo" disabled={!history.future.length} onClick={redo}><Redo2 size={16}/></IconButton>
        <IconButton label="Help and shortcuts" onClick={()=>setOverlay('help')}><CircleHelp size={16}/></IconButton>
        <button className="btn secondary save-btn" onClick={save}><Save size={15}/>Save</button>
        <button className="btn primary" onClick={()=>setOverlay('export')}><Download size={15}/>Export</button>
      </div>
    </header>
    <nav className="tabs" aria-label="Workspaces">
      {tab('Script',overlay==='script',()=>setOverlay('script'),<FileText size={15}/>)}
      {tab('Stage',mode==='stage'&&!overlay,()=>switchMode('stage'),<Box size={15}/>)}
      {tab('Blocking',mode==='blocking'&&!overlay,()=>switchMode('blocking'),<Waypoints size={15}/>)}
      {tab('Cameras',mode==='cameras'&&!overlay,()=>switchMode('cameras'),<CameraIcon size={15}/>)}
      <span className="tab-gap"/>
      {tab('References',overlay==='references',()=>setOverlay('references'),<FileImage size={15}/>)}
      {tab('Video Generation',overlay==='video',()=>{setPlaying(false);setOverlay('video');},<Video size={15}/>)}
      {tab('Export',overlay==='export',()=>setOverlay('export'),<Download size={15}/>)}
      <span className="tabs-end">
        <IconButton label={collapsed.left?'Show scene hierarchy':'Hide scene hierarchy'} onClick={()=>setCollapsed(v=>({...v,left:!v.left}))}><Layers3 size={15}/></IconButton>
        <IconButton label={collapsed.right?'Show inspector':'Hide inspector'} onClick={()=>setCollapsed(v=>({...v,right:!v.right}))}><Focus size={15}/></IconButton>
      </span>
    </nav>
    <div className="workspace">
      <aside className="sidebar" ref={leftPane}>
        <div className="panel-heading"><h2>Scene</h2><IconButton label="Import project or script" onClick={()=>setOverlay('script')}><FolderOpen size={15}/></IconButton></div>
        <div className="scene-root"><Layers3 size={15}/><select aria-label="Active stage" value={stage.id} onChange={e=>{const next=p.stages?.find(s=>s.id===e.target.value);if(next)switchStage(next);}}>
          <option value={stage.id}>{stage.name}</option>{p.stages?.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></div>
        <div className="scene-scroll">
          {mode!=='cameras'&&<div className="list-label">{mode==='stage'?'Stage objects':'Moving subjects'}<span>{visibleObjects.length}</span></div>}
          {mode!=='cameras'&&objectGroups.map(group=><div key={group} className="object-group">
            {group&&<div className="group-label"><Layers3 size={13}/>{group}</div>}
            {visibleObjects.filter(o=>mode!=='stage'||o.group===group).map(o=>{
            const Icon=stageIcons[o.kind]??Box;
            return <div className={'scene-row '+(selected?.id===o.id?'row-active':'')} key={o.id}>
              <button className="entity" onClick={()=>setSelected(mode==='blocking'&&p.tracks.some(t=>t.objectId===o.id)?{kind:'path',id:o.id,index:0}:{kind:'object',id:o.id})}>
                <Icon size={15}/><span>{o.name}</span>
              </button>
              <IconButton label={o.visible?'Hide '+o.name:'Show '+o.name} onClick={()=>objectChange(o.id,{visible:!o.visible})}>{o.visible?<Eye size={13}/>:<EyeOff size={13}/>}</IconButton>
              <IconButton label={o.locked?'Unlock '+o.name:'Lock '+o.name} onClick={()=>objectChange(o.id,{locked:!o.locked})}>{o.locked?<Lock size={13}/>:<Unlock size={13}/>}</IconButton>
            </div>;
          })}</div>)}
          {mode==='blocking'&&<Field label="Select any stage object"><select value={object?.id??''} onChange={e=>{if(e.target.value)setSelected({kind:'object',id:e.target.value});}}>
            <option value="">Choose object…</option>{p.stage.objects.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}
          </select></Field>}
          <div className="list-label">Shots<span>{p.shots.length}</span></div>
          {p.shots.map((s,i)=><button className={'shot-item '+(s.id===shot.id?'shot-active':'')} key={s.id} onClick={()=>{chooseShot(i);if(mode==='stage')setMode('cameras');}}><span className="shot-index">{String(i+1).padStart(2,'0')}</span><CameraIcon size={14}/><span>{s.name}</span><small>{Number(s.duration.toFixed(2))}s</small></button>)}
        </div>
        {mode==='stage'?<div className="sidebar-footer">{!!p.reusable?.length&&<details className="reusable-shelf"><summary>Reusable objects</summary>{p.reusable.map(o=><button key={o.id} className="text-action" draggable onDragStart={e=>e.dataTransfer.setData('application/cinecontrol-asset',o.id)} onClick={()=>placeReusable(o.id,[0,0,0])}>{o.name}</button>)}</details>}<div className="addline">
          <select aria-label="New object type" value={objectKind} onChange={e=>setObjectKind(e.target.value as StageObject['kind'])}>{kinds.filter(k=>!['asset','character'].includes(k)).map(k=><option key={k} value={k}>{titleCase(k)}</option>)}</select>
          <IconButton label="Add object" onClick={addObject}><Plus size={16}/></IconButton>
        </div><button className="btn secondary" onClick={()=>setOverlay('assets')}><FolderOpen size={14}/>Manage stages &amp; assets</button></div>:
        <div className="sidebar-footer">{mode==='blocking'&&<button className="btn secondary" onClick={addCharacter}><Plus size={15}/>Add character</button>}<button className="btn secondary" onClick={()=>editShot('add')}><Plus size={15}/>Add shot</button></div>}
        <div className="resize-edge right-edge" onPointerDown={e=>resizePanel(e,'left')}/>
      </aside>
      <section className={'viewports mode-'+viewMode} aria-label="3D viewports">
        <div className="world-panel">
          <div className="viewport-header">
            <div><Grid2X2 size={14}/><strong>World View</strong></div>
            <div><select aria-label="World view angle" value={view} onChange={e=>setView(e.target.value)}>{['Perspective','Top','Front','Side'].map(v=><option key={v}>{v}</option>)}</select>
              <IconButton label={viewMode==='world'?'Restore split view':'Maximize World View'} onClick={()=>setViewMode(viewMode==='world'?'split':'world')}>{viewMode==='world'?<Minimize2 size={14}/>:<Maximize2 size={14}/>}</IconButton>
            </div>
          </div>
          <div className="world-host" ref={worldPane} aria-label="World View canvas"
            onDragOver={e=>{if(mode==='stage')e.preventDefault();}}
            onDrop={e=>{if(mode!=='stage')return;e.preventDefault();const pos=viewport.current?.dropPosition(e.clientX,e.clientY)??[0,0,0];
              const id=e.dataTransfer.getData('application/cinecontrol-asset');
              if(id)placeReusable(id,pos);else void importAssets(Array.from(e.dataTransfer.files),pos);}}/>
          <div className="viewport-tools">
            {toolModes.map(([v,Icon,label])=><IconButton key={v} label={label} selected={transform===v} disabled={mode!=='stage'&&v!=='translate'} onClick={()=>setTransform(v)}><Icon size={16}/></IconButton>)}
            <span/>
            <IconButton label="Toggle grid" selected={grid} onClick={()=>setGrid(v=>!v)}><Grid2X2 size={15}/></IconButton>
            <IconButton label="Toggle axes" selected={axes} onClick={()=>setAxes(v=>!v)}><Focus size={15}/></IconButton>
            <IconButton label="Toggle snapping" selected={snap} onClick={()=>setSnap(v=>!v)}><MousePointer2 size={15}/></IconButton>
          </div>
          {mode==='blocking'&&<div className="world-legend"><span><i/>Actor path</span><span><i/>Vehicle path</span></div>}
          {engineError&&<div className="engine-warning">{engineError}</div>}
        </div>
        <div className="camera-panel">
          <div className="viewport-header"><div><CameraIcon size={14}/><strong>Camera View</strong></div><div>
            <IconButton label={viewMode==='camera'?'Restore split view':'Maximize Camera View'} onClick={()=>setViewMode(viewMode==='camera'?'split':'camera')}>{viewMode==='camera'?<Minimize2 size={14}/>:<Maximize2 size={14}/>}</IconButton>
          </div></div>
          <div className="camera-host" ref={cameraPane} aria-label="Live portrait camera view"/>
          <div className="camera-foot"><div><span className="live-dot"/><span>{shot.name}</span></div>
            <select aria-label="Camera preview pass" value={pass} onChange={e=>setPass(e.target.value as Pass|'scene')}><option value="scene">Scene</option>{passes.map(s=><option key={s} value={s}>{titleCase(s)}</option>)}</select>
          </div>
        </div>
      </section>
      <aside className="inspector">
        <div className="resize-edge left-edge" onPointerDown={e=>resizePanel(e,'right')}/>
        <div className="panel-heading"><h2>Inspector</h2><span className="tiny-tab">{titleCase(mode)}</span></div>
        <div className="inspector-scroll">
        {mode==='stage'&&<>
          <div className="inspect-title"><Box size={17}/><b>{object?.name??'Stage bounds'}</b></div>
          {object?<>
            {object.source&&<p className="muted">{object.source==='proxy'?'Approximation':titleCase(object.source)}{object.role?' · '+object.role:''}</p>}
            <Field label="Object name"><input aria-label="Object name" key={object.id+object.name} defaultValue={object.name} onBlur={e=>{const name=e.target.value.trim();if(name)objectChange(object.id,{name});}}/></Field>
            <div className="inspect-section">
              <Vector label="Position (m)" value={object.position} onChange={position=>objectChange(object.id,{position})} disabled={object.locked}/>
              <Vector label="Rotation (°)" value={object.rotation} onChange={rotation=>objectChange(object.id,{rotation})} disabled={object.locked}/>
              <Vector label="Dimensions (m)" value={object.size} onChange={size=>objectChange(object.id,{size})} disabled={object.locked}/>
              <Vector label="Scale" value={object.scale} onChange={scale=>objectChange(object.id,{scale})} disabled={object.locked}/>
              <Field label="Group"><input aria-label="Object group" key={object.id+object.group} defaultValue={object.group} onBlur={e=>objectChange(object.id,{group:e.target.value})}/></Field>
              {object.group&&<button className="text-action" onClick={()=>objectChange(object.id,{group:''})}>Ungroup object</button>}
              <Field label="Color"><input type="color" aria-label="Object color" value={object.color} onChange={e=>objectChange(object.id,{color:e.target.value})}/></Field>
            </div>
            {object.source==='proxy'&&<label className="btn secondary"><Upload size={14}/>Replace proxy model<input type="file" multiple aria-label="Replace proxy model" accept=".glb,.gltf,.bin,.png,.jpg,.jpeg,.webp" onChange={e=>{void importAssets(Array.from(e.target.files??[]),[0,0,0],object.id);e.target.value='';}}/></label>}
            <div className="button-row"><button className="btn secondary" onClick={()=>duplicateObject(object)}><Copy size={14}/>Duplicate</button><IconButton label="Delete object" disabled={object.locked} onClick={()=>removeObject(object)}><Trash2 size={15}/></IconButton></div>
          </>:<Vector label="Stage bounds (m)" value={p.stage.bounds} onChange={bounds=>commit(q=>{q.stage.bounds=bounds;})}/>}
          <div className="rule"/>{object&&<button className="btn secondary wide" onClick={()=>saveReusable(object)}><Save size={14}/>Save to asset library</button>}<button className="btn secondary wide" onClick={()=>download(slug(p.title)+'-stage.json',json(p.stage))}><Download size={14}/>Save stage JSON</button>
        </>}
        {mode==='blocking'&&<>
          <div className="inspect-title"><Waypoints size={17}/><b>{object?.name??'Blocking'}</b></div>
          {object?<>{object.kind==='character'&&<>
            <Field label="Character name"><input key={object.id+object.name} defaultValue={object.name} onBlur={e=>{const value=e.target.value.trim();if(value)objectChange(object.id,{name:value});}}/></Field>
            <Field label="Height (m)"><NumberField label="Character height" value={object.size[1]} min={.1} max={5} onChange={h=>objectChange(object.id,{size:[object.size[0],h,object.size[2]]})}/></Field>
            <Field label="Identity ID"><input key={object.id+(object.identityId??'')} defaultValue={object.identityId??object.id} onBlur={e=>objectChange(object.id,{identityId:e.target.value.trim()||undefined})}/></Field>
            {!track&&<Vector label="Starting position (m)" value={object.position} onChange={position=>objectChange(object.id,{position})} disabled={object.locked}/>}
            <label className="btn secondary"><Upload size={14}/>{object.assetId?'Replace character model':'Attach character model'}<input type="file" multiple aria-label="Attach character model" accept=".glb,.gltf,.bin,.png,.jpg,.jpeg,.webp" onChange={e=>{void importAssets(Array.from(e.target.files??[]),[0,0,0],object.id);e.target.value='';}}/></label>
          </>}<Field label="Action"><select aria-label="Blocking action" value={track?.action??'hold'} disabled={!track||object.locked} onChange={e=>commit(q=>{q.tracks.find(v=>v.objectId===object.id)!.action=e.target.value as typeof actions[number];})}>{actions.map(a=><option key={a} value={a}>{titleCase(a)}</option>)}</select></Field>
          {track&&<div className="motion-state"><span>Position at playhead</span><code>{objectState(object,track,where.time).position.map(fmt).join('  /  ')} m</code></div>}
          <div className="rule"/><div className="section-label"><b>Keyframes</b><IconButton label="Add keyframe at playhead" onClick={()=>addKey(object.id)} disabled={object.locked}><Plus size={15}/></IconButton></div>
          {track?.keys.map((key,i)=><button key={key.time} className={'key-list '+(activeKey===i?'active-key':'')} onClick={()=>{setSelected({kind:'path',id:object.id,index:i});const dest=timelineKey(key.time);if(dest!==null)setTime(dest);}}><i/><span>Point {i+1}</span><code>{fmt(key.time)} s</code></button>)}
          {track?.keys[activeKey]&&<div className="key-properties">
            <Vector label="Point position (m)" value={track.keys[activeKey].position} disabled={object.locked} onChange={position=>keyChange(object.id,activeKey,{position})}/>
            <div className="two-fields"><Field label="Time (s)"><NumberField label="Keyframe time" value={track.keys[activeKey].time} min={0} max={600} disabled={object.locked} onChange={t=>keyChange(object.id,activeKey,{time:t})}/></Field>
            <Field label="Interpolation"><select aria-label="Keyframe interpolation" value={track.keys[activeKey].interpolation??'linear'} disabled={object.locked} onChange={e=>keyChange(object.id,activeKey,{interpolation:e.target.value as Key['interpolation']})}><option value="linear">Linear</option><option value="ease">Ease</option><option value="hold">Hold</option></select></Field></div>
            <Vector label="Key rotation (°)" value={objectState(object,track,track.keys[activeKey].time).rotation} disabled={object.locked} onChange={rotation=>keyChange(object.id,activeKey,{rotation})}/>
            <div className="button-row"><button className="btn secondary" disabled={object.locked||track.keys[activeKey].time>=599} onClick={()=>{
              const key=track.keys[activeKey], hold=key.time+1;
              if(track.keys.some(k=>k.time===hold)){status('A keyframe already exists one second later.');return;}
              commit(q=>{const t=q.tracks.find(r=>r.objectId===object.id)!;t.keys=orderKeys([...t.keys,{...key,time:hold}]);});
            }}><Pause size={14}/>Hold 1 s</button>
            <IconButton label="Duplicate keyframe" disabled={object.locked} onClick={duplicateKey}><Copy size={15}/></IconButton>
            <IconButton label="Delete keyframe" disabled={object.locked||track.keys.length<2} onClick={()=>deleteKey(object,activeKey)}><Trash2 size={15}/></IconButton></div>
          </div>}
          {!track&&<button className="btn secondary" onClick={()=>addKey(object.id)} disabled={object.locked}><Plus size={14}/>Create motion track</button>}
          </>:<p className="muted">Select a moving subject to edit its path.</p>}
          <div className="rule"/>
          <button className="btn secondary wide" onClick={()=>download(slug(p.title)+'-blocking.json',json(p.tracks))}><Download size={14}/>Save blocking JSON</button>
          <button className="text-action" onClick={()=>{
            const original=p.id===street.id?street:history.past.find(a=>a.id===p.id);
            if(!original){status('No earlier blocking snapshot is available.');return;}
            const ids=new Set(p.stage.objects.map(o=>o.id));
            if(commit(q=>{q.tracks=structuredClone(original.tracks.filter(t=>ids.has(t.objectId)));}))status('Blocking restored.');
          }}>Restore original blocking</button>
        </>}
        {mode==='cameras'&&<>
          <div className="inspect-title"><CameraIcon size={17}/><b>{shot.name}</b></div>
          <Field label="Shot name"><input aria-label="Shot name" key={shot.id+shot.name} defaultValue={shot.name} onBlur={e=>{const name=e.target.value.trim();if(name)shotChange(shot.id,{name});}}/></Field>
          <div className="two-fields"><Field label="Blocking start (s)"><NumberField label="Blocking start" value={shot.start} min={0} max={600-shot.duration} onChange={start=>shotChange(shot.id,{start})}/></Field>
          <Field label="Duration (s)"><NumberField label="Shot duration" value={shot.duration} min={.1} max={30} onChange={duration=>shotChange(shot.id,{duration})}/></Field></div>
          <div className="button-row"><IconButton label="Move shot earlier" disabled={!where.index} onClick={()=>editShot('earlier')}><ChevronUp size={16}/></IconButton><IconButton label="Move shot later" disabled={where.index===p.shots.length-1} onClick={()=>editShot('later')}><ChevronDown size={16}/></IconButton><IconButton label="Duplicate shot" onClick={()=>editShot('duplicate')}><Copy size={15}/></IconButton><IconButton label="Delete shot" onClick={()=>editShot('delete')} disabled={p.shots.length<2}><Trash2 size={15}/></IconButton></div>
          <p className="muted">Duration changes shift the edited sequence. Blocking times and other shots’ source intervals stay fixed.</p>
          <div className="rule"/>
          <Field label="Camera preset"><select aria-label="Camera preset" value="" onChange={e=>{if(e.target.value)cameraChange(camera.id,presetCamera(e.target.value as typeof presets[number],p,shot));}}><option value="">Choose a preset…</option>{presets.map(s=><option key={s}>{s}</option>)}</select></Field>
          <Vector label="Camera position (m)" value={camera.position} onChange={position=>cameraChange(camera.id,{position})}/>
          <Vector label="Camera target (m)" value={camera.target} onChange={target=>cameraChange(camera.id,{target})}/>
          <div className="two-fields"><Field label="Field of view (°)"><NumberField label="Field of view" value={camera.fov} min={10} max={130} onChange={fov=>cameraChange(camera.id,{fov})}/></Field>
          <Field label="Roll (°)"><NumberField label="Camera roll" value={camera.roll} onChange={roll=>cameraChange(camera.id,{roll})}/></Field></div>
          <div className="section-label"><b>Camera keyframes</b><IconButton label="Add camera keyframe at playhead" onClick={()=>{
            const when=Number(where.time.toFixed(3));
            cameraChange(camera.id,{keys:orderKeys([...camera.keys,{time:when,position:camera.position,target:camera.target}])});
          }}><Plus size={15}/></IconButton></div>
          {camera.keys.map((k,i)=><details className="camera-key" key={k.time}><summary>{fmt(k.time)} s</summary>
            <Vector label="Key position" value={k.position} onChange={position=>cameraChange(camera.id,{keys:camera.keys.map((row,index)=>index===i?{...row,position}:row)})}/>
            <Vector label="Key target" value={k.target} onChange={target=>cameraChange(camera.id,{keys:camera.keys.map((row,index)=>index===i?{...row,target}:row)})}/>
            <Field label="Interpolation"><select value={k.interpolation??'linear'} onChange={e=>cameraChange(camera.id,{keys:camera.keys.map((row,index)=>index===i?{...row,interpolation:e.target.value as Key['interpolation']}:row)})}><option value="linear">Linear</option><option value="ease">Ease</option><option value="hold">Hold</option></select></Field>
            <button className="text-action" onClick={()=>cameraChange(camera.id,{keys:camera.keys.filter((_,index)=>index!==i)})}>Remove keyframe</button>
          </details>)}
        </>}
        </div>
      </aside>
    </div>
    <section className="timeline" ref={timelinePane} aria-label="Timeline">
      <div className="resize-edge top-edge" onPointerDown={e=>resizePanel(e,'timeline')}/>
      <div className="timeline-header">
        <div className="timeline-title"><IconButton label={collapsed.timeline?'Expand timeline':'Collapse timeline'} onClick={()=>setCollapsed(v=>({...v,timeline:!v.timeline}))}><ChevronDown size={16}/></IconButton><h2>Timeline</h2><span>{p.shots.length} shots · {fmt(seq)} s</span></div>
        <div className="transport">
          <IconButton label="Previous frame" onClick={()=>{setPlaying(false);setTime(t=>clamp(t-1/p.fps,0,seq));}}><SkipBack size={16}/></IconButton>
          <IconButton label="Stop and return to start" onClick={()=>{setPlaying(false);setTime(seekOnly?where.cut:0);}}><Square size={13}/></IconButton>
          <IconButton label={playing?'Pause':'Play'} selected={playing} onClick={()=>{if(!playing&&time>=seq)setTime(0);setPlaying(v=>!v);}}>{playing?<Pause size={17}/>:<Play size={17}/>}</IconButton>
          <IconButton label="Next frame" onClick={()=>{setPlaying(false);setTime(t=>clamp(t+1/p.fps,0,seq));}}><SkipForward size={16}/></IconButton>
          <IconButton label="Toggle loop" selected={loop} onClick={()=>setLoop(v=>!v)}><Repeat size={15}/></IconButton>
        </div>
        <div className="time-actions"><button className="timeline-key-add" type="button" disabled={!object||object.locked||mode!=='blocking'} onClick={()=>{if(object)addKey(object.id);}}><Plus size={12}/>Keyframe</button>
          <IconButton label="Snap to frames and keyframes" selected={timelineSnap} onClick={()=>setTimelineSnap(v=>!v)}><Focus size={13}/></IconButton><span className="timecode">{fmt(time)} s</span><span className="frame-label">F{String(Math.floor(time*p.fps)).padStart(3,'0')}</span>
          <select aria-label="Playback scope" value={seekOnly?'shot':'all'} onChange={e=>setSeekOnly(e.target.value==='shot')}><option value="all">Sequence</option><option value="shot">Shot</option></select>
          <select aria-label="Playback speed" value={rate} onChange={e=>setRate(+e.target.value)}>{[.25,.5,1,1.5,2].map(n=><option key={n} value={n}>{n}×</option>)}</select>
          <select aria-label="Project frame rate" value={p.fps} onChange={e=>commit(q=>{q.fps=+e.target.value;})}>{[...new Set([15,24,25,30,48,60,p.fps])].sort((a,b)=>a-b).map(f=><option key={f} value={f}>{f} fps</option>)}</select>
        </div>
      </div>
      <div className="timeline-body">
        <div className="track-names"><div className="ruler-label">TRACKS</div><div><CameraIcon size={14}/>Shots</div>{p.tracks.map(t=><div key={t.objectId}><Waypoints size={14}/>{p.stage.objects.find(o=>o.id===t.objectId)?.name}</div>)}{p.cameras.some(c=>c.keys.length>0)&&<div><CameraIcon size={14}/>Camera keys</div>}</div>
        <div className="time-area" onPointerDown={scrub}>
          <div className="ruler" role="slider" tabIndex={0} aria-label="Playhead" aria-valuenow={time} aria-valuemin={0} aria-valuemax={seq} onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.stopPropagation();setTime(t=>clamp(t+(e.key==='ArrowLeft'?-1:1)/p.fps,0,seq));}}}>
            {ticks.map(t=><span key={t} style={mark(t)}>{t}s</span>)}</div>
          <div className="shot-track">{p.shots.map((s,i)=><button key={s.id} className={'clip '+(s.id===shot.id?'current-clip':'')} style={{...mark(cutAt(p,i)),width:(s.duration/seq*100)+'%'}} onClick={()=>{chooseShot(i);if(mode==='stage')setMode('cameras');}}><b>{String(i+1).padStart(2,'0')}</b>{s.name}</button>)}</div>
          {p.tracks.map(t=>{
            const color=t.action==='drive'?'blue':'orange';
            const begin=timelineKey(t.keys[0].time),end=timelineKey(t.keys[t.keys.length-1].time);
            return <div key={t.objectId} className={'motion-track '+color}>
              {begin!==null&&end!==null&&end>begin&&<div className="motion-bar" style={{...mark(begin),width:((end-begin)/seq*100)+'%'}}>{titleCase(t.action)}</div>}
              {t.keys.map((k,i)=>{const place=timelineKey(k.time);return place===null?null:keyButton(t.objectId,i,place,k.time,'Select '+(p.stage.objects.find(o=>o.id===t.objectId)?.name??'object')+' keyframe '+(i+1));})}
            </div>;
          })}
          {p.cameras.some(c=>c.keys.length>0)&&<div className="motion-track camera-track">{p.cameras.flatMap(c=>c.keys.map((k,i)=>{const place=timelineKey(k.time);return place===null?null:<span key={c.id+k.time}>{keyButton(c.id,i,place,k.time,c.name+' keyframe '+(i+1),true)}</span>;}))}</div>}
          <div className="playhead" style={mark(Math.min(time,seq))}/>
        </div>
      </div>
    </section>
    <footer className="statusbar"><span><i/> {ready?(viewport.current?.software?'3D preview · software':'3D preview ready'):'3D preview unavailable'}</span><span>{overlap?'Overlap · '+overlap:'Scene time '+fmt(where.time)+' s'}</span><span>Metres · +Y up</span></footer>
    {notice&&<div className="toast" role="status">{notice}</div>}
    {overlay&&<div className="overlay" onPointerDown={e=>{if(e.target===e.currentTarget&&progress===null)setOverlay(null);}}>
      <section className={'dialog dialog-'+overlay} role="dialog" aria-modal="true" aria-label={titleCase(overlay)}>
        <div className="dialog-heading"><h2>{({script:'Script to scene',references:'Shot references',export:'Export',video:'Video generation',help:'Controls and project files',assets:'Stages and assets'})[overlay]}</h2><IconButton label="Close workspace" onClick={()=>setOverlay(null)} disabled={progress!==null}><X size={20}/></IconButton></div>
        {overlay==='script'&&<div className="dialog-body script-body">
          <div className="toolbar-line"><FileButton accept=".txt,.json,.zip" label="Open script, JSON or project ZIP" onFile={f=>void applyFile(f)}/><button className="btn secondary" onClick={()=>{load(structuredClone(street),true);setTime(defaultPlayhead);setMode('blocking');setSelected({kind:'path',id:'jogger',index:1});}}><Clapperboard size={15}/>Street sample</button></div>
          <section className="export-section">
            <h3 className="workspace-label">ChatGPT scene JSON</h3>
            <Field label="Scene JSON"><textarea aria-label="Scene JSON" maxLength={4*1024*1024} rows={3} value={sceneText} onChange={e=>setSceneText(e.target.value)} placeholder="Paste JSON from the scene generator kit"/></Field>
            <div className="toolbar-line">
              <button className="btn primary" disabled={!sceneText.trim()||!!sceneBusy} onClick={()=>{try{void readImportedScene(JSON.parse(sceneText));}catch(error){setSceneError(err(error));}}}>Build scene from JSON</button>
              <button className="btn secondary" disabled={!!sceneBusy} onClick={()=>void loadSceneSample()}>Observatory example</button>
              <button className="btn secondary" onClick={()=>void exportSceneKit()}><Download size={14}/>ChatGPT scene generator kit</button>
            </div>
            {sceneBusy&&<p role="status">{sceneBusy}</p>}
            {sceneError&&<pre className="scene-errors" role="alert">{sceneError}</pre>}
            {p.sceneReport&&<ImportReport report={p.sceneReport}/>}
          </section>
          <Field label="Project title"><input key={p.id+p.title} defaultValue={p.title} onBlur={changedTitle}/></Field>
          <Field label="Scene script"><textarea rows={6} value={script} maxLength={18000} onChange={e=>setScript(e.target.value)}/></Field>
          <Field label="Generate"><select aria-label="Generation scope" value={draftScope} onChange={e=>{setDraftScope(e.target.value as typeof draftScope);setDraft(null);}}>
            <option value="all">Complete scene</option><option value="stage">Stage only</option><option value="blocking">Blocking only</option><option value="cameras">Cameras and shots only</option>
          </select></Field>
          <div className="toolbar-line"><button className="btn primary" disabled={pending} onClick={()=>void generate()}><Aperture size={15}/>{pending?'Generating scene…':'Generate scene'}</button>
            <button className="btn secondary" onClick={()=>{if(commit(q=>{q.script=script;})){setOverlay(null);status('Script saved to project.');}}}>Keep script</button>
            <button className="text-action" onClick={()=>{setScript(streetScript);setDraft(null);}}>Use sample script</button>
          </div>
          {draft&&<div className="draft"><div className="section-label"><b>Review scene draft</b><span>{draft.stage.objects.length} objects · {draft.tracks.length} tracks · {draft.shots.length} shots</span></div>
            <details><summary>Review object names and shot actions</summary><div className="draft-items">
              {draft.stage.objects.map(o=><Field key={o.id} label={titleCase(o.kind)}>
                <input aria-label={'Draft object '+o.id} defaultValue={o.name} onBlur={e=>{const value=e.target.value.trim();if(value&&value!==o.name)changeDraft(d=>{d.stage.objects.find(a=>a.id===o.id)!.name=value;});}}/>
              </Field>)}
              {draft.shots.map(s=><Field key={s.id} label={s.name}>
                <textarea aria-label={'Draft action '+s.name} rows={2} defaultValue={s.prompt} onBlur={e=>{if(e.target.value!==s.prompt)changeDraft(d=>{d.shots.find(a=>a.id===s.id)!.prompt=e.target.value;});}}/>
              </Field>)}
            </div></details>
            <details><summary>Edit structured draft</summary><textarea aria-label="Draft JSON" value={draftText} rows={8} onChange={e=>setDraftText(e.target.value)}/></details>
            <button className="btn primary" onClick={applyDraft}><Check size={15}/>Open in editor</button>
          </div>}
        </div>}
        {overlay==='references'&&<div className="dialog-body">
          <ShotSelect p={p} index={where.index} onChange={chooseShot}/>
          <ReferencePanel p={p} shot={shot} revision={mediaVersion} refresh={refresh} status={status} ready={ready} imageApi={capabilities.image} capture={capture}/>
        </div>}
        {overlay==='export'&&<div className="dialog-body">
          <ShotSelect p={p} index={where.index} onChange={chooseShot}/>
          <div className="two-fields"><label className="check"><input type="checkbox" disabled={progress!==null} checked={exportAll} onChange={e=>setExportAll(e.target.checked)}/>Export all shots</label>
          {exportAll&&<Field label="All-shot layout"><select value={layout} disabled={progress!==null} onChange={e=>setLayout(e.target.value as Layout)}><option value="separate">Separate files for every shot</option><option value="stitched">Stitched sequence</option><option value="both">Separate files and stitched sequence</option></select></Field>}</div>
          <div className="two-fields"><Field label="Resolution"><select value={sourceSize} onChange={e=>setSourceSize(e.target.value)}><option value="288x512">288 × 512 · Draft</option><option value="480x854">480 × 854 · Seedance reference</option><option value="576x1024">576 × 1024</option><option value="720x1280">720 × 1280</option></select></Field>
          <Field label="Frame rate"><select value={exportFps} onChange={e=>setExportFps(+e.target.value)}>{[...new Set([12,15,24,30,48,60,exportFps])].sort((a,b)=>a-b).map(f=><option key={f} value={f}>{f} fps</option>)}</select></Field></div>
          <div className="two-fields"><Field label="Shot-local start (s)"><NumberField label="Export start" value={exportStart} onChange={setExportStart} min={0} max={30}/></Field><Field label="Shot-local end (0 = full length)"><NumberField label="Export end" value={exportEnd} onChange={setExportEnd} min={0} max={30}/></Field></div>
          {!capabilities.mp4&&<p className="caution">MP4 encoder unavailable. Install the updated backend requirements and restart. PNG sequences are available.</p>}
          <section className="export-section"><h3 className="workspace-label">3D previs video</h3><p className="muted">Regular animation from the selected camera.</p>
          <button className="btn primary" disabled={!ready||!capabilities.mp4||progress!==null} onClick={()=>void startExport('preview')}><Download size={15}/>Export Preview MP4</button></section>
          <section className="export-section"><h3 className="workspace-label">AI guidance videos</h3>
            <div className="export-passes">{passes.map(type=><div key={type}><label className="check"><input type="checkbox" checked={exportPasses.includes(type)} onChange={e=>setExportPasses(v=>e.target.checked?[...v,type]:v.filter(a=>a!==type))}/>{titleCase(type)}</label><button className="text-action" disabled={!ready||progress!==null} onClick={()=>{setPass(type);setOverlay(null);}}>Preview</button></div>)}</div>
            <p className="muted">Pose uses projected proxy joints. PNGs preserve pixel values for depth and normal passes.</p>
            <div className="toolbar-line"><button className="btn primary" disabled={!ready||!capabilities.mp4||progress!==null} onClick={()=>void startExport('guides')}><Download size={15}/>Export Guidance MP4s</button>
            <button className="btn secondary" disabled={!ready||progress!==null} onClick={()=>void startExport('png')}>Export PNG Sequences</button></div>
          </section>
          {progress!==null&&<div className="export-progress"><progress max="100" value={progress}/><span>{progress}%</span></div>}
          {exportNote&&<p className="review-meta" role="status">{exportNote}</p>}
          {exportFiles&&<div className="toolbar-line"><button className="btn secondary" onClick={()=>download(exportFiles.filename,exportFiles.zip)}>Download ZIP again</button>
            {exportFiles.completed.map(file=><button key={file.name} className="text-action" onClick={()=>download(file.name.replace('/','-'),exportFiles.files[file.name])}>{file.name}</button>)}</div>}
          <section className="export-section"><h3 className="workspace-label">Project and 3D data</h3>
          <label className="check"><input type="checkbox" checked={includeBulky} onChange={e=>setIncludeBulky(e.target.checked)}/>Include exported guidance and generated clips</label>
          <div className="toolbar-line"><button className="btn secondary" disabled={bundleBusy||progress!==null} onClick={()=>void saveBundle()}>{bundleBusy?'Packing project…':'Export Project Bundle'}</button>
          <button className="btn secondary" onClick={()=>download(slug(p.title)+'.json',json(p))}>Project JSON</button>
          <button className="btn secondary" onClick={()=>download(slug(p.title)+'-blocking.json',json(p.tracks))}>Blocking JSON</button>
          <button className="btn secondary" onClick={()=>download(slug(p.title)+'-cameras.json',json({cameras:p.cameras,shots:p.shots}))}>Cameras and shots</button>
          <button className="btn secondary" disabled={!ready||progress!==null} onClick={()=>{setPlaying(false);void viewport.current?.glb().then(file=>download(slug(p.title)+'.glb',file)).catch(error=>status(err(error)));}}>Stage GLB</button></div></section>
        </div>}
        {overlay==='video'&&<div className="dialog-body">
          <ShotSelect p={p} index={where.index} onChange={chooseShot}/>
          <VideoPanel p={p} shot={shot} revision={mediaVersion} refresh={refresh} status={status} api={capabilities.seedance} preview={reviewFrame} approval={approval} changeApproval={changeApproval} reviewAll={reviewAll}
            reviewSequence={()=>{setReviewAll(true);chooseShot(0);}} nextClip={()=>{if(!reviewAll)return;const i=where.index+1;if(i<p.shots.length){setTime(cutAt(p,i));setSelected({kind:'camera',id:p.shots[i].cameraId});}else setReviewAll(false);}}
            review3D={()=>{setViewMode('split');switchMode('blocking');}}/>
        </div>}
        {overlay==='assets'&&<div className="dialog-body">
          <p className="muted">Each stage has its own objects, blocking and camera sequence. Switching stages keeps the current sequence in the project.</p>
          <Field label="Active stage name"><input key={stage.id+stage.name} defaultValue={stage.name} onBlur={e=>{const value=e.target.value.trim();if(value)commit(q=>{q.stageName=value;});}}/></Field>
          <div className="toolbar-line"><input aria-label="New stage name" placeholder="New stage name" value={newStageName} onChange={e=>setNewStageName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')createStage();}}/><button className="btn secondary" onClick={createStage}>Create stage</button></div>
          <div className="toolbar-line">{p.stages?.map(s=><button className="btn secondary" key={s.id} onClick={()=>switchStage(s)}>{s.name}</button>)}</div>
          <div className="toolbar-line">
            <button className="btn secondary" onClick={duplicateStage}>Duplicate active stage</button>
            <button className="btn secondary" onClick={()=>download(slug(stage.name)+'-sequence.json',json({kind:'cinecontrol-stage',version:1,stage}))}>Save active stage and shots</button>
            <FileButton label="Add stage from JSON" accept=".json" onFile={file=>void openStageSequence(file,false)}/>
            <FileButton label="Replace active stage" accept=".json" onFile={file=>void openStageSequence(file,true)}/>
          </div>
          <h3 className="workspace-label">Local model library</h3>
          <div className="toolbar-line">
            <select aria-label="Local model" value={catalogSelection} onChange={e=>setCatalogSelection(e.target.value)}>{libraryAssets.map(asset=><option key={asset.id} value={asset.id}>{asset.name}</option>)}</select>
            <button className="btn secondary" disabled={assetBusy} onClick={()=>void placeCatalogModel()}>Add model to stage</button>
          </div>
          <p className="muted">{getAsset(catalogSelection)?.credit} · {getAsset(catalogSelection)?.license}</p>
          <div className="toolbar-line">
            <select aria-label="Procedural prefab" value={prefab} onChange={e=>setPrefab(e.target.value as Generator)}>{(['building','room','deck','tree','terrain','road','bench','lantern','crate'] as const).map(key=><option key={key} value={key}>{titleCase(key)}</option>)}</select>
            <button className="btn secondary" onClick={()=>void placePrefab()}>Generate prefab on stage</button>
          </div>
          {p.sceneReport&&<ImportReport report={p.sceneReport}/>}
          <h3 className="workspace-label">Import independent assets</h3>
          <p className="muted">Select multiple GLB models, or GLTF files with their local companion files. Files dropped into World View are placed on the floor at the drop point.</p>
          <div className="toolbar-line"><label className="btn secondary"><Upload size={14}/>{assetBusy?'Importing…':'Import model collection'}<input aria-label="Import model collection" type="file" multiple accept=".glb,.gltf,.bin,.png,.jpg,.jpeg,.webp,.ktx2" disabled={assetBusy} onChange={e=>{void importAssets(Array.from(e.target.files??[]));e.target.value='';}}/></label>
          <FileButton label="Merge stage JSON" accept=".json" onFile={f=>void importStage(f)}/></div>
          <h3 className="workspace-label">Reusable objects</h3>
          {p.reusable?.length?<div className="ref-grid-three">{p.reusable.map(o=><div className="ref-card" key={o.id}><b>{o.name}</b><button className="btn secondary" onClick={()=>placeReusable(o.id,[0,0,0])}>Add to current stage</button></div>)}</div>:<p className="muted">Select a stage object and use Save to asset library to reuse it here.</p>}
        </div>}
        {overlay==='help'&&<div className="dialog-body help-body">
          <p><b>Orbit</b> Drag with the left mouse button. <b>Pan</b> Right-drag. <b>Zoom</b> Scroll.</p>
          <p><b>Space</b> Play / pause. <b>← →</b> Step through frames. <b>1, 2, 3</b> Stage, blocking, cameras.</p>
          <p><b>Ctrl+S</b> Save project. <b>Ctrl+Z</b> Undo. <b>Ctrl+Shift+Z</b> Redo.</p>
          <p>Drag the edges of the hierarchy, inspector or timeline to resize them.</p>
          <p>Drag timeline diamonds to retime keyframes. Select a keyframe to edit in the inspector. Use Export Project Bundle to move models and references to another computer.</p>
          <details className="legacy-tools"><summary>Legacy and developer tools</summary><p>The original room editor opens v2 indoor drafts.</p><a className="btn secondary" href="./room.html">Open original room editor</a></details>
        </div>}
      </section>
    </div>}
  </div>;
}

function ShotSelect({p,index,onChange}:{p:Project;index:number;onChange:(value:number)=>void}){
  return <Field label="Shot"><select aria-label="Select shot" value={index} onChange={e=>onChange(+e.target.value)}>
    {p.shots.map((s,i)=><option key={s.id} value={i}>{String(i+1).padStart(2,'0')} · {s.name}</option>)}
  </select></Field>;
}

function ImportReport({report}:{report:SceneReport}){
  return <details className="scene-report">
    <summary>Scene import report · {report.proxies||report.warnings.length?'Approximate':'Complete'}</summary>
    <p>{report.exact} library models · {report.procedural} procedural · {report.composed} composed · {report.proxies} proxies · {report.tracks} tracks · {report.shots} shots</p>
    {!!report.assumptions?.length&&<p>{report.assumptions.join(' · ')}</p>}
    {report.warnings.length>0&&<ul>{report.warnings.map((warning,i)=><li key={i}>{warning}</li>)}</ul>}
  </details>;
}
