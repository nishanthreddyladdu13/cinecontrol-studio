import { useEffect, useState } from 'react';
import { Camera, Download, FileImage, Upload } from 'lucide-react';
import { download, readPrefix, writeMedia, type Media } from './media';
import { cameraImage, cameraKey, cameraPrompt, cameraSlots, characterKey, characterPrompt, characterViews, cinematicImage, cinematicKey, dataURL, imagePromptPack, imageSlots, meta, putMeta, sceneFingerprint, storeImage, styleKey, type CameraSlot, type ImageSlot } from './references';
import { type Project, type Shot } from './project';

export const errorText=(error:unknown)=>error instanceof Error?error.message:String(error);
export const cap=(s:string)=>s[0].toUpperCase()+s.slice(1);
export function UploadButton({label,onFile,accepted='image/png,image/jpeg,image/webp',disabled=false}:{label:string;onFile:(f:File)=>void;accepted?:string;disabled?:boolean}){
  return <label className={'btn secondary'+(disabled?' disabled':'')}><Upload size={14}/>{label}<input aria-label={label} type="file" disabled={disabled} accept={accepted} onChange={e=>{
    const f=e.currentTarget.files?.[0];if(f)onFile(f);e.currentTarget.value='';
  }}/></label>;
}
export function useFiles(projectId:string,revision:number){
  const [files,setFiles]=useState<Record<string,{media:Media;url:string}>>({});
  useEffect(()=>{
    let alive=true;
    const urls:string[]=[];
    setFiles({});
    void readPrefix(projectId+'/').then(entries=>{
      if(!alive)return;
      setFiles(Object.fromEntries(entries.map(([key,media])=>{
        const url=URL.createObjectURL(media.blob);urls.push(url);return [key,{media,url}];
      })));
    }).catch(()=>{if(alive)setFiles({});});
    return ()=>{alive=false;urls.forEach(URL.revokeObjectURL);};
  },[projectId,revision]);
  return files;
}
type Props={
  p:Project;shot:Shot;revision:number;refresh:()=>void;status:(s:string)=>void;ready:boolean;imageApi:boolean;
  capture:(slot:CameraSlot)=>Promise<void>;
};
const tabs=['3D Camera Frames','Cinematic Shot Images','Character Library','Environment/Style Library'] as const;

export function ReferencePanel({p,shot,revision,refresh,status,ready,imageApi,capture}:Props){
  const [tab,setTab]=useState<typeof tabs[number]>(tabs[0]);
  const [selectedId,setSelectedId]=useState('');
  const [working,setWorking]=useState(false);
  const [consent,setConsent]=useState(false);
  const files=useFiles(p.id,revision);
  const people=p.stage.objects.filter(o=>o.kind==='character');
  const actor=people.find(o=>o.id===selectedId)??people[0];
  const report=(fn:()=>Promise<void>)=>void fn().catch(e=>status(errorText(e)));
  const saveImage=(key:string,f:File)=>report(async()=>{await storeImage(key,{name:f.name,blob:f});refresh();});
  const saveText=(key:string,value:Parameters<typeof putMeta>[1])=>{putMeta(key,value);refresh();};
  const getCine=(slot:ImageSlot)=>files[cinematicKey(p,shot,slot)]??files[p.id+'/'+shot.id+'/'+slot];
  function card(key:string,label:string,items?:React.ReactNode,entry=files[key]){
    const current=meta(key);
    return <article className="ref-card" key={key}>
      <div className="section-label"><b>{label}</b>{entry&&<span>{current.approved?'Approved':'Review pending'}</span>}</div>
      {entry?<img src={entry.url} alt={label}/>:<div className="empty-media"><FileImage size={22}/><span>Choose an image</span></div>}
      <div className="toolbar-line"><UploadButton label={entry?'Replace '+label:'Upload '+label} onFile={f=>saveImage(key,f)}/>
      {entry&&<button className="btn secondary" onClick={()=>saveText(key,{approved:!current.approved})}>{current.approved?'Unapprove':'Approve'}</button>}</div>
      {entry&&<button className="text-action" onClick={()=>download(entry.media.name,entry.media.blob)}>Download image</button>}
      {items}
    </article>;
  }
  async function generate(slot:ImageSlot,prompt:string){
    const source=await cameraImage(p,shot,slot);
    if(!source)throw Error('Capture the matching 3D frame before generating a cinematic image.');
    if(!consent)throw Error('Confirm the paid image request first.');
    setWorking(true);
    try {
      const response=await fetch('/api/previs/cinematic-image',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({prompt,image:await dataURL(source.blob),confirm_charge:true}),signal:AbortSignal.timeout(115000)});
      if(!response.ok)throw Error((await response.json().catch(()=>null))?.detail??'Cinematic image generation failed.');
      const blob=await response.blob();
      const key=cinematicKey(p,shot,slot);
      await storeImage(key,{name:shot.id+'-'+slot+'.png',blob});
      saveText(key,{prompt,approved:false});status('Cinematic image ready for review.');
    }finally{setWorking(false);setConsent(false);}
  }
  return <>
    <div className="workspace-subtabs" role="tablist" aria-label="Reference workspaces">
      {tabs.map(name=><button key={name} type="button" role="tab" aria-selected={tab===name} onClick={()=>setTab(name)}>{name}</button>)}
    </div>
    {tab===tabs[0]&&<>
      <p className="muted">Capture the selected 3D camera to preserve framing and geometry.</p>
      <div className="ref-grid-three">
        {cameraSlots.map(slot=>{
          const key=cameraKey(p,shot,slot),image=files[key],m=meta(key);
          const wrong=m.fingerprint&&m.fingerprint!==sceneFingerprint(p,shot);
          return <article className="ref-card" key={key}>
            <b>{cap(slot)} 3D frame</b>
            {image?<img src={image.url} alt={cap(slot)+' 3D frame'}/>:<div className="empty-media"><Camera size={22}/><span>Capture from 3D camera</span></div>}
            {image&&<span className={wrong?'caution':'muted'}>{wrong?'Refresh after scene or camera edits':((m.time??0).toFixed(3)+' s · scene time')}</span>}
            <div className="toolbar-line"><button className="btn secondary" disabled={!ready} onClick={()=>report(()=>capture(slot))}><Camera size={14}/>{image?'Refresh':'Capture'} {slot}</button>
            {image&&<button className="btn secondary" onClick={()=>download(image.media.name,image.media.blob)}><Download size={14}/>Download</button>}</div>
          </article>;
        })}
      </div>
    </>}
    {tab===tabs[1]&&<>
      <p className="muted">Set the cinematic look for this shot. Use its 3D frame to guide image generation, then approve the image for video.</p>
      {imageApi&&<label className="check"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>Authorize the next paid Stability image request</label>}
      <div className="ref-grid-three">{imageSlots.map(slot=>{
        const key=cinematicKey(p,shot,slot),current=meta(key),prompt=current.prompt??cameraPrompt(p,shot);
        return card(key,cap(slot),<>
          <label className="form-field"><span>Image prompt</span><textarea aria-label={cap(slot)+' image prompt'} key={key+prompt} rows={4} defaultValue={prompt} onBlur={e=>saveText(key,{prompt:e.target.value})}/></label>
          <div className="toolbar-line"><button className="btn secondary" onClick={()=>report(async()=>download(shot.id+'-'+slot+'-image-kit.zip',await imagePromptPack(p,shot,slot,meta(key).prompt??prompt)))}>Download frame + prompt</button>
          {imageApi&&<button className="btn secondary" disabled={!consent||working} onClick={()=>report(()=>generate(slot,meta(key).prompt??prompt))}>{working?'Generating…':getCine(slot)?'Regenerate image':'Generate image'}</button>}</div>
          {files[key]&&<button className="text-action" onClick={()=>report(async()=>{await writeMedia(key,null);saveText(key,{approved:false});})}>Remove</button>}
        </>,getCine(slot));
      })}</div>
    </>}
    {tab===tabs[2]&&(actor?<>
      <p className="muted">Reuse one approved identity sheet across shots. For individual angles, use the same approved sheet or front image as the identity reference.</p>
      <label className="form-field"><span>Character</span><select value={actor.id} onChange={e=>setSelectedId(e.target.value)}>{people.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
      <div className="review-meta">Identity {actor.identityId??actor.id} · {actor.size[1].toFixed(2)} m</div>
      <div className="multi-fields">{(['description','appearance','clothing'] as const).map(field=><label className="form-field" key={actor.id+field}><span>{cap(field)}</span><input defaultValue={meta(characterKey(p,actor,'profile'))[field]??''} onBlur={e=>saveText(characterKey(p,actor,'profile'),{[field]:e.target.value})}/></label>)}</div>
      <div className="ref-grid-three">{characterViews.map(view=>card(characterKey(p,actor,view),cap(view),<button className="text-action" onClick={()=>download(actor.id+'-'+view+'-prompt.txt',characterPrompt(p,actor,view))}>Download identity prompt</button>))}</div>
    </>:<p className="muted">Add a character in Blocking to prepare an identity sheet.</p>)}
    {tab===tabs[3]&&<>
      <p className="muted">These approved references are shared across the project. Use them for location texture, lighting, color and atmosphere.</p>
      <div className="ref-grid-three">{['environment','style'].map(slot=>{
        const key=styleKey(p,slot);
        return card(key,cap(slot),<label className="form-field"><span>Visual notes</span><textarea defaultValue={meta(key).description??''} rows={3} onBlur={e=>saveText(key,{description:e.target.value})}/></label>);
      })}</div>
    </>}
  </>;
}
