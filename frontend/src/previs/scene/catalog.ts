import manifest from '../../../public/scene-kit/asset-manifest.json';
import type { StageObject, Track, V3 } from '../project';

type BuiltinAsset={id:string;name:string;category:string;tags:string[];path:string;size:V3;yaw:number;
  rig:string|null;clips:string[];actions:Partial<Record<Track['action'],string>>;
  credit:string;license:string;source:string;licenseFile:string};
export const libraryAssets=manifest.assets as BuiltinAsset[];
export const getAsset=(id:string)=>libraryAssets.find(asset=>asset.id===id);
const normalize=(value:string)=>value.toLowerCase().trim().replace(/[ -]+/g,'-');

export function matchAsset(category?:string,tags:string[]=[]){
  if(!category&&!tags.length)return;
  const term=normalize(category??'');
  const words=new Set(tags.map(normalize));
  const choices=libraryAssets.map(asset=>({asset,score:(asset.category===term?20:0)+
    (asset.tags.some(tag=>normalize(tag)===term)?8:0)+asset.tags.filter(tag=>words.has(normalize(tag))).length}));
  return choices.sort((a,b)=>b.score-a.score).find(choice=>choice.score>=2)?.asset;
}

export function libraryObject(asset:BuiltinAsset,id:string,position:V3):Partial<StageObject>{
  return {id,name:asset.name,kind:asset.category==='human'?'character':'asset',assetId:asset.id,size:asset.size,position,source:'exact'};
}
