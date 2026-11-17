import { useEffect, useRef, useState } from 'react';
import { Check, Download, Play, Video } from 'lucide-react';
import { zipSync } from 'fflate';
import { activeSequence, passes, type Project, type Shot } from './project';
import { download, writeMedia } from './media';
import { guideSlot, utf } from './export';
import { mimeExt, shotMediaKey } from './references';
import { cap, errorText, UploadButton, useFiles } from './ReferencePanel';
import { collectSeedance, guideLabels, inspectVideo, seedanceBundle, seedanceModel, seedanceRequest, shotPrompt, type SeedanceMode, type SeedanceOptions } from './seedance';

type Props={
  p:Project;shot:Shot;revision:number;refresh:()=>void;status:(s:string)=>void;api:boolean;
  preview:string;approval:string;changeApproval:(value:'Approved'|'Needs revision'|'Unreviewed')=>void;
  reviewAll:boolean;reviewSequence:()=>void;nextClip:()=>void;review3D:()=>void;
};
const competitors=['Seedance 2.5','Kling 3 Omni','Wan Fun Control'] as const;
type Provider=typeof competitors[number];
export function VideoPanel(props:Props){
  const {p,shot,revision,refresh,status,api,preview,approval,changeApproval,reviewAll,reviewSequence,nextClip,review3D}=props;
  const [provider,setProvider]=useState<Provider>(competitors[0]);
  const [mode,setMode]=useState<SeedanceMode>('omni');
  const [ratio,setRatio]=useState('9:16');
  const [resolution,setResolution]=useState('720p');
  const [duration,setDuration]=useState(Math.max(4,Math.round(shot.duration)));
  const [audio,setAudio]=useState(false);
  const [items,setItems]=useState<Awaited<ReturnType<typeof collectSeedance>>>([]);
  const [enabled,setEnabled]=useState<string[]>([]);
  const [urls,setUrls]=useState<Record<string,string>>({});
  const [consent,setConsent]=useState(false);
  const [busy,setBusy]=useState('');
  const [task,setTask]=useState('');
  const [taskStatus,setTaskStatus]=useState('');
  const [action,setAction]=useState(shot.prompt);
  const [override,setOverride]=useState(false);
  const files=useFiles(p.id,revision);
  const lastMode=useRef('');
  const clip=files[shotMediaKey(p,shot,'clip')];
  const camera=p.cameras.find(c=>c.id===shot.cameraId);
  const promptKey=p.id+'/'+shot.id+'/video-action';
  useEffect(()=>{
    const saved=localStorage.getItem(promptKey);
    setOverride(saved!==null);setAction(saved??shot.prompt);
    setDuration(Math.max(4,Math.round(shot.duration)));setUrls({});setConsent(false);
    setTask(localStorage.getItem(p.id+'/'+shot.id+'/seedance-task')??'');setTaskStatus('');
  },[promptKey,shot.duration,shot.prompt]);
  const prompt=override?action:shotPrompt(p,shot);
  const actualMode=provider==='Seedance 2.5'?mode:'omni';
  useEffect(()=>{
    let alive=true;
    const selectedMode=shot.id+'/'+provider+'/'+actualMode;
    void collectSeedance(p,shot,actualMode).then(found=>{
      if(!alive)return;
      const eligible=(provider==='Kling 3 Omni'?found.filter(i=>i.role==='reference_image'):
        provider==='Wan Fun Control'?found.filter(i=>i.id==='depth'||i.id==='pose'||i.id==='opening'):found);
      setItems(eligible);
      const reset=lastMode.current!==selectedMode;lastMode.current=selectedMode;
      setEnabled(old=>eligible.filter(i=>!i.issue&&(reset?(!i.experimental&&(i.role!=='reference_video'||i.id==='clay')):old.includes(i.id)||!old.length&&!i.experimental)).map(i=>i.id));
    }).catch(e=>status(errorText(e)));
    return ()=>{alive=false;};
  },[p,shot,actualMode,provider,revision]);
  const opts:SeedanceOptions={mode,duration,ratio:mode==='frames'?'adaptive':ratio,resolution,audio};
  const doWork=(label:string,fn:()=>Promise<void>)=>{setBusy(label);void fn().catch(e=>status(errorText(e))).finally(()=>setBusy(''));};
  async function pack(){
    if(provider==='Seedance 2.5'){download(shot.id+'-seedance.zip',await seedanceBundle(p,shot,prompt,items,enabled,opts));return;}
    const selected=items.filter(i=>enabled.includes(i.id));
    if(provider==='Wan Fun Control'&&selected.filter(i=>i.role==='reference_video').length!==1)throw Error('Choose one depth or pose video for the dedicated Wan control workflow.');
    const files:Record<string,Uint8Array>={'prompt.txt':new TextEncoder().encode(prompt),'shot.json':utf(shot)};
    const references=[];
    for(const item of selected){
      const path='references/'+item.id.replaceAll('/','-')+'.'+mimeExt(item.media);
      files[path]=new Uint8Array(await item.media.blob.arrayBuffer());
      references.push({path,role:provider==='Wan Fun Control'&&item.role==='reference_video'?item.id+'_control':item.role});
    }
    files['request.json']=utf({mode:'manual',provider,references});
    download(shot.id+'-manual.zip',zipSync(files,{level:0}));
  }
  const uploadClip=(f:File)=>doWork('Importing clip…',async()=>{
    if(f.size>150*1024*1024)throw Error('Clip exceeds the 150 MB local import limit.');
    if(!/\.(mp4|webm|mov)$/i.test(f.name))throw Error('Choose an MP4, WebM or MOV file.');
    await writeMedia(shotMediaKey(p,shot,'clip'),{name:f.name,blob:f});changeApproval('Unreviewed');refresh();status('Clip imported.');
  });
  async function start(){
    if(!consent||!api)throw Error('Confirm this paid request first.');
    const body=await seedanceRequest(prompt,items,enabled,opts,urls);
    const res=await fetch('/api/previs/seedance',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(65000)});
    const result=await res.json().catch(()=>null);
    if(!res.ok||!result?.id)throw Error(result?.detail??'ModelArk did not accept the request.');
    localStorage.setItem(p.id+'/'+shot.id+'/seedance-task',result.id);setTask(result.id);setTaskStatus('queued');setConsent(false);
  }
  async function check(){
    const res=await fetch('/api/previs/seedance/'+task,{signal:AbortSignal.timeout(40000)});
    const result=await res.json().catch(()=>null);
    if(!res.ok)throw Error(result?.detail??'Could not get task status.');
    setTaskStatus(result.status);
  }
  async function importTake(){
    const res=await fetch('/api/previs/seedance/'+task+'/video',{signal:AbortSignal.timeout(90000)});
    if(!res.ok)throw Error((await res.json().catch(()=>null))?.detail??'Could not download the completed clip.');
    await writeMedia(shotMediaKey(p,shot,'clip'),{name:shot.id+'-seedance.mp4',blob:await res.blob()});
    changeApproval('Unreviewed');refresh();
  }
  function toggle(id:string,checked:boolean){setEnabled(old=>checked?[...old,id]:old.filter(v=>v!==id));}
  return <>
    <div className="review-meta"><b>{shot.name}</b> · {shot.duration.toFixed(2)} s previs · {p.fps} fps · {camera?.name} · {activeSequence(p).name} <button className="text-action" onClick={review3D}>Open 3D view</button></div>
    <div className="multi-fields">
      <label className="form-field"><span>Provider</span><select value={provider} onChange={e=>{setProvider(e.target.value as Provider);setConsent(false);}}>{competitors.map(m=><option key={m}>{m}</option>)}</select></label>
      {provider==='Seedance 2.5'&&<label className="form-field"><span>Generation mode</span><select value={mode} onChange={e=>{setMode(e.target.value as SeedanceMode);setConsent(false);}}><option value="omni">Omni references</option><option value="frames">First / last frames</option><option value="text">Text to video</option></select></label>}
    </div>
    {provider==='Seedance 2.5'&&<><p className="muted">{mode==='omni'?'Clay can guide camera and motion. Depth, normal and pose are experimental general video references.':mode==='frames'?'Use an approved cinematic first frame and optional last frame. The aspect ratio follows the opening image.':'Use the shot prompt without guide clips or images.'}</p>
      <div className="multi-fields"><label className="form-field"><span>Output duration (s)</span><input type="number" min="4" max="30" step="1" value={duration} onChange={e=>setDuration(+e.target.value)}/></label>
      <label className="form-field"><span>Aspect ratio</span><select value={mode==='frames'?'adaptive':ratio} disabled={mode==='frames'} onChange={e=>setRatio(e.target.value)}>{['9:16','16:9','1:1','4:3','3:4','21:9','adaptive'].map(v=><option key={v}>{v}</option>)}</select></label>
      <label className="form-field"><span>Output resolution</span><select value={resolution} onChange={e=>setResolution(e.target.value)}>{['480p','720p','1080p'].map(v=><option key={v}>{v}</option>)}</select></label>
      <label className="check"><input type="checkbox" checked={audio} onChange={e=>setAudio(e.target.checked)}/>Generate audio</label></div></>}
    {provider!=='Seedance 2.5'&&<p className="muted">{provider==='Wan Fun Control'?'Prepare one depth or pose clip for a dedicated Wan Fun Control graph. Choose the matching conditioning node in your external workflow.':'Prepare approved appearance images for a manual Kling reference workflow.'}</p>}
    <h3 className="workspace-label">Guidance videos</h3>
    <div className="guide-grid">{passes.map(pass=>{
      const key=shotMediaKey(p,shot,guideSlot(pass)),media=files[key],item=items.find(i=>i.id===pass);
      return <article className="ref-card" key={pass}><b>{cap(pass)}</b>{media?<video controls preload="metadata" src={media.url}/>:<div className="empty-media"><Video size={18}/><span>Export or attach a clip</span></div>}
      <small className={item?.issue?'caution':'muted'}>{item?.issue??(media?guideLabels[pass]:'No guide saved for this shot')}</small>
      <UploadButton label={media?'Replace '+cap(pass):'Attach '+cap(pass)} accepted=".mp4,.mov" disabled={!!busy} onFile={f=>doWork('Reading video…',async()=>{await writeMedia(key,await inspectVideo(f));refresh();})}/>
      {media&&<button className="text-action" onClick={()=>download(media.media.name,media.media.blob)}>Download</button>}
      <label className="check"><input type="checkbox" disabled={!item||!!item.issue||!!busy} checked={!!item&&enabled.includes(pass)} onChange={e=>toggle(pass,e.target.checked)}/>Enable for request</label>
      {api&&provider==='Seedance 2.5'&&item&&enabled.includes(pass)&&<input aria-label={cap(pass)+' public URL'} placeholder="HTTPS URL or asset ID for API" value={urls[pass]??''} onChange={e=>setUrls(v=>({...v,[pass]:e.target.value}))}/>}</article>;
    })}</div>
    <h3 className="workspace-label">Approved visual references</h3>
    {items.some(i=>i.approved)?<div className="visual-reference-grid">{items.filter(i=>i.approved).map(i=><label className="check" key={i.id}><input type="checkbox" checked={enabled.includes(i.id)} disabled={!!i.issue||!!busy} onChange={e=>toggle(i.id,e.target.checked)}/><span>{i.label}{i.issue&&<small className="caution"> · {i.issue}</small>}</span></label>)}</div>:
      <p className="muted">Approved cinematic or identity images compatible with this mode appear here.</p>}
    <label className="form-field"><span>Action prompt · {override?'edited':'auto-prepared'}</span><textarea aria-label="Video action prompt" rows={5} value={prompt} onChange={e=>{setOverride(true);setAction(e.target.value);localStorage.setItem(promptKey,e.target.value);}}/></label>
    {override&&<button className="text-action" onClick={()=>{setOverride(false);localStorage.removeItem(promptKey);}}>Restore automatic prompt</button>}
    <div className="toolbar-line"><button className="btn primary" disabled={!!busy} onClick={()=>doWork('Preparing generation package…',pack)}><Download size={15}/>Prepare manual generation package</button>{busy&&<span role="status" className="muted">{busy}</span>}</div>
    {provider==='Seedance 2.5'&&api&&<div className="provider-api">
      <p className="muted">{seedanceModel} uses your configured ModelArk account. Video references must already be reachable by the provider. Use synthetic or provider-approved identity references.</p>
      <label className="check"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>Authorize the next paid request and submission of selected references</label>
      <div className="toolbar-line"><button className="btn secondary" disabled={!!busy||!consent} onClick={()=>doWork('Submitting request…',start)}>Generate using API</button>
      {task&&<button className="btn secondary" disabled={!!busy} onClick={()=>doWork('Checking task…',check)}>Check task status</button>}
      {taskStatus&&<span role="status">{taskStatus}</span>}
      {taskStatus==='succeeded'&&<button className="btn secondary" disabled={!!busy} onClick={()=>doWork('Importing clip…',importTake)}>Import generated take</button>}</div>
    </div>}
    <h3 className="workspace-label">Generated take review · {approval}</h3>
    <div className="compare-media">
      <div><small>3D camera frame</small>{preview&&<img src={preview} alt="3D camera frame at the playhead"/>}</div>
      <div><small>Generated take</small>{clip?<video className="review-video" key={clip.url+reviewAll} controls autoPlay={reviewAll} src={clip.url} onEnded={nextClip}/>:<div className="empty-video"><Video size={20}/>Import a finished clip for comparison.</div>}</div>
    </div>
    <div className="toolbar-line"><UploadButton label={clip?'Replace clip':'Import clip'} accepted=".mp4,.webm,.mov" disabled={!!busy} onFile={uploadClip}/>
      <button className="btn secondary" onClick={reviewSequence}><Play size={14}/>Review sequence</button>
      {clip&&<><button className="btn secondary" onClick={()=>changeApproval('Approved')}><Check size={14}/>Approve</button><button className="btn secondary" onClick={()=>changeApproval('Needs revision')}>Needs revision</button>
      <button className="btn secondary" onClick={()=>download(clip.media.name,clip.media.blob)}><Download size={14}/>Download take</button></>}
    </div>
  </>;
}
