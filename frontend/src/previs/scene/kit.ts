import { zipSync } from 'fflate';

const names=['MASTER_SCENE_JSON_GENERATOR_PROMPT.md','README.md','scene-schema.json','capabilities.json','asset-manifest.json',
  'examples/observatory.json','examples/courtyard.json','examples/basketball.json','examples/forest.json','examples/sluice.json','examples/road.json'];
export async function sceneKit(){
  const entries=await Promise.all(names.map(async name=>{
    const response=await fetch(import.meta.env.BASE_URL+'scene-kit/'+name);
    if(!response.ok)throw Error('Scene kit file could not be read: '+name);
    return [name,new Uint8Array(await response.arrayBuffer())] as const;
  }));
  return zipSync(Object.fromEntries(entries));
}
