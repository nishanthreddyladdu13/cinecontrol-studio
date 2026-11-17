import { readMedia, readPrefix, writeCollection, type Media } from './media';
import { getAsset } from './scene/catalog';
import { uid } from './project';
import type { Viewport } from './viewport';

const maxModel=50*1024*1024;
export async function storeModels(engine:Viewport,files:File[]){
  const models=files.filter(f=>/\.(gltf|glb)$/i.test(f.name));
  if(!models.length)throw Error('Choose a GLB or a GLTF with its companion files.');
  if(files.reduce((n,f)=>n+f.size,0)>100*1024*1024)throw Error('Each asset batch must be 100 MB or less.');
  const out=[];
  for(const file of models){
    if(file.size>maxModel)throw Error('Each model must be 50 MB or less.');
    const id=uid(),dependencies:Record<string,Blob>={};
    const rows:[string,Media][]=[['asset/'+id,{blob:file,name:file.name}]];
    if(/\.gltf$/i.test(file.name)){
      const parsed=JSON.parse(await file.text());
      const uses=[...parsed.buffers??[],...parsed.images??[]].flatMap(part=>typeof part.uri==='string'?[part.uri]:[]);
      for(const uri of new Set<string>(uses)){
        if(uri.startsWith('data:'))continue;
        if(/^(?:[a-z]+:|\/)|(?:^|\/)\.\.(?:\/|$)/i.test(uri))throw Error('GLTF dependencies must use relative local paths.');
        const name=decodeURIComponent(uri.split('/').at(-1)!);
        const matches=files.filter(f=>f.name===name);
        if(matches.length!==1)throw Error('Select exactly one companion file named '+name+'.');
        const dep=matches[0];dependencies[uri]=dep;
        rows.push(['asset/'+id+'/dep/'+encodeURIComponent(uri),{blob:dep,name:dep.name}]);
      }
    }
    const size=await engine.loadAsset(id,file,dependencies);
    await writeCollection(rows);
    out.push({id,name:file.name.replace(/\.(gltf|glb)$/i,'').slice(0,100),size});
  }
  return out;
}
export async function restoreModel(engine:Viewport,id:string){
  if(getAsset(id)){await engine.loadBuiltin(id);return;}
  const model=await readMedia('asset/'+id);
  if(!model)return;
  const prefix='asset/'+id+'/dep/';
  const dependencies=await readPrefix(prefix);
  await engine.loadAsset(id,model.blob,Object.fromEntries(dependencies.map(([key,item])=>[decodeURIComponent(key.slice(prefix.length)),item.blob])));
}
