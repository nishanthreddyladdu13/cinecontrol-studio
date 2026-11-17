import Ajv from 'ajv';
import schema from '../../../public/scene-kit/scene-schema.json';
import type { Key, StageObject, Track, V3 } from '../project';
import type { Generator } from './generators';
import type { Part } from './model';

export type Placement={relation:'on'|'inside'|'beside'|'front'|'behind'|'attached'|'above'|'below'|'near'|'along'|'between';
  target:string; other?:string; offset?:V3; side?:'left'|'right'|'front'|'back'; gap?:number};
export type ObjectInput={id:string;name:string;role?:string;category?:string;assetId?:string;tags?:string[];
  position?:V3;rotation?:V3;size?:V3;color?:string;group?:string;identityId?:string;
  actor?:'human'|'creature'|'vehicle';walkable?:boolean;solid?:boolean;primitive?:'box'|'sphere'|'cylinder'|'cone'|'capsule'|'torus';
  generator?:Generator;parameters?:Parameters<typeof import('./generators').generateModel>[3];parts?:Part[];
  place?:Placement;facing?:string;clip?:string};
export type Waypoint={position:V3;surface?:string};
export type TrackInput={objectId:string;action:Track['action'];clip?:string;keys?:(Key & {surface?:string})[];
  path?:{points:Waypoint[];start?:number;duration:number;navigate?:boolean};
  physics?:{start?:number;duration:number;velocity?:V3;gravity?:number;restitution?:number}};
export type Preset='establishing'|'wide'|'medium'|'close'|'over-shoulder'|'tracking'|'follow'|'orbit'|'dolly'|'low'|'high'|'first-person'|'attached';
export type ShotInput={id:string;name:string;start?:number;duration:number;prompt?:string;
  preset?:Preset;subjects?:string[];attachTo?:string;position?:V3;target?:V3;fov?:number;roll?:number;
  keys?:{time:number;position:V3;target:V3;interpolation?:Key['interpolation']}[]};
export type StageInput={id:string;name:string;bounds:V3;duration?:number;objects:ObjectInput[];
  tracks?:TrackInput[];shots?:ShotInput[];look?:string};
export type SceneInput={sceneFormat:'cinecontrol.scene/1';id:string;title:string;script?:string;units?:'m';axis?:'Y-up';
  fps?:number;quality?:'blockout'|'enhanced';assumptions?:string[];look?:string;stages:StageInput[]};
export type SceneObject=StageObject & { source?:'exact'|'procedural'|'composed'|'proxy' };

const validate=new Ajv({allErrors:true,strictRequired:false,strictTuples:false}).compile<SceneInput>(schema);
export function readScene(value:unknown):SceneInput {
  if(!validate(value)){
    const errors=(validate.errors??[]).slice(0,9).map(error=>{
      const prefix=error.instancePath||'/';
      const field=error.params.additionalProperty? ' ('+error.params.additionalProperty+')':'';
      return prefix+' '+(error.message??'is invalid')+field;
    });
    throw Error(errors.join('\n'));
  }
  return value;
}

