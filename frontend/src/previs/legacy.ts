import { z } from 'zod';
import { objectSchema, orderKeys, projectSchema, type Camera, type Key, type Project, type StageObject, type Track, type V3 } from './project';

const vec=z.tuple([z.number(),z.number(),z.number()]);
const point=z.object({pos:vec,facing:z.union([vec,z.string()]).optional(),pose:z.string().optional()});
const aim=z.union([vec,z.string()]);
const legacySchema=z.object({
  schema_version:z.literal('0.1'),
  assumptions:z.array(z.string()).default([]),
  scene:z.object({
    id:z.string(),fps:z.number().default(24),
    set:z.object({
      bounds:z.object({width:z.number(),height:z.number(),depth:z.number()}),
      street_layout:z.object({
        road_width:z.number().positive(),road_length:z.number().positive(),
        left_sidewalk_width:z.number().positive().default(2),right_sidewalk_width:z.number().positive().default(2),
        streetlight_height:z.number().positive().default(4),streetlight_spacing:z.number().positive().default(16),
        tree_spacing:z.number().positive().default(9),building_count:z.number().int().nonnegative().default(6),
      }),
      props:z.array(z.object({
        id:z.string(),type:z.string(),pos:vec,size:vec,color:z.string().optional(),rotation_y:z.number().optional(),visible:z.boolean().optional(),
      })).default([]),
    }),
    characters:z.array(z.object({id:z.string(),height:z.number().positive(),outfit:z.object({top:z.string()}).optional()})).default([]),
  }),
  shots:z.array(z.object({
    id:z.string(),duration:z.number().positive(),action:z.string().default(''),
    camera:z.object({
      mode:z.enum(['free','follow','pov']).default('free'),lens_mm:z.number().positive().default(35),
      start:z.object({pos:vec,look_at:aim.optional()}).optional(),end:z.object({pos:vec,look_at:aim.optional()}).optional(),
      target:z.string().optional(),attach_to:z.string().optional(),offset:vec.optional(),look_at_offset:vec.optional(),
    }),
    blocking:z.array(z.object({who:z.string(),start:point,end:point.optional()})).default([]),
    props:z.array(z.object({
      id:z.string(),move:z.object({start:vec,end:vec}).optional(),
      rotate:z.object({start:z.number(),end:z.number()}).optional(),
      show:z.object({start:z.boolean(),end:z.boolean()}).optional(),
    })).default([]),
  })).min(1),
});
const friendly=(name:string)=>name.replace(/^(?:shot_)?\d+_/,'').replace(/[_-]+/g,' ').replace(/\b\w/g,s=>s.toUpperCase());
const plus=(a:V3,b:V3)=>a.map((v,i)=>v+b[i]) as V3;
const yaw=(from:V3,to:V3)=>Math.hypot(to[0]-from[0],to[2]-from[2])>.001 ? Math.atan2(to[0]-from[0],to[2]-from[2])*180/Math.PI:undefined;

export function importProject(input:unknown):Project {
  if(typeof input==='object'&&input!==null&&'schema_version' in input && input.schema_version==='0.1') {
    const old=legacySchema.safeParse(input);
    if(!old.success)throw new Error('The importer supports legacy 0.1 street scenes with street_layout and valid camera settings.');
    return convertStreet(old.data);
  }
  return projectSchema.parse(input);
}

function convertStreet(old:z.infer<typeof legacySchema>){
  const {scene}=old,{set}=scene,{street_layout:spec}=set;
  const {road_width:w,road_length:length,left_sidewalk_width:left,right_sidewalk_width:right}=spec;
  const objects:StageObject[]=[];
  const tracks=new Map<string,Track>();
  const cameras:Camera[]=[];
  let clock=0;
  function add(id:string,kind:StageObject['kind'],position:V3,size:V3,color:string,group=''){
    const o=objectSchema.parse({id,name:friendly(id),kind,position,size,color,group});objects.push(o);return o;
  }
  function addKey(id:string,action:Track['action'],key:Key){
    const original=tracks.get(id);
    if(original)original.keys.push(key);
    else tracks.set(id,{objectId:id,action,keys:[key]});
  }
  add('layout-road','road',[0,-.15,0],[w,.15,length],'#38404b');
  add('layout-left-sidewalk','sidewalk',[w/2+left/2,-.09,0],[left,.24,length],'#78818b');
  add('layout-right-sidewalk','sidewalk',[-w/2-right/2,-.09,0],[right,.24,length],'#78818b');
  for(const sign of [-1,1]){
    const side=sign===1?left:right,edge=sign*(w/2+side);
    const count=(spacing:number)=>Math.min(18,Math.max(1,Math.round(length/spacing)));
    for(let i=0;i<count(spec.tree_spacing);i++){
      const z=length*((i+.45)/count(spec.tree_spacing)-.5);
      add('layout-tree-'+sign+'-'+i,'tree',[edge+sign*.5,0,z],[2.4,4.55,2.5],'#4e7462','Street context');
    }
    for(let i=0;i<count(spec.streetlight_spacing);i++){
      const z=length*((i+.4)/count(spec.streetlight_spacing)-.5);
      const lamp=add('layout-lamp-'+sign+'-'+i,'lamp',[edge-sign*.35,.15,z],[.92,spec.streetlight_height,.45],'#a6a3a0','Street context');
      if(sign<0)lamp.rotation[1]=180;
    }
    const n=Math.min(14,sign===1?Math.ceil(spec.building_count/2):Math.floor(spec.building_count/2));
    for(let i=0;i<n;i++){
      const z=length*((i+.53)/n-.5);
      add('layout-building-'+sign+'-'+i,'building',[edge+sign*3.25,0,z],[3.4,4.4+i%3,Math.min(15,length/n*.8)],'#647083','Street context');
    }
  }
  for(const p of set.props){
    const kind:StageObject['kind']=['car','sedan','suv','hatchback','vehicle'].includes(p.type)?'car':'box';
    const o=add(p.id,kind,p.pos,p.size,p.color??'#6781a8');
    o.rotation[1]=p.rotation_y??0;
    if(p.visible===false)addKey(o.id,kind==='car'?'drive':'hold',{time:0,position:o.position,yaw:o.rotation[1],visible:false});
  }
  for(const actor of scene.characters){
    const first=old.shots.flatMap(s=>s.blocking).find(b=>b.who===actor.id);
    add(actor.id,'character',first?.start.pos??[0,0,0],[.61,actor.height,.48],actor.outfit?.top??'#ed845b');
  }
  const shots=old.shots.map(s=>{
    const start=clock;clock+=s.duration;
    for(const b of s.blocking){
      const end=b.end??b.start;
      const style=(b.start.pose??'').toLowerCase();
      const action:Track['action']=style.includes('jog')||style.includes('run')?'jog':style.includes('sit')?'sit':'walk';
      addKey(b.who,action,{time:start,position:b.start.pos,yaw:Array.isArray(b.start.facing)?yaw(b.start.pos,b.start.facing):undefined});
      addKey(b.who,action,{time:clock,position:end.pos,yaw:Array.isArray(end.facing)?yaw(end.pos,end.facing):undefined});
    }
    for(const p of s.props){
      const o=objects.find(x=>x.id===p.id);
      if(!o)continue;
      const t=tracks.get(o.id),last=t?.keys.at(-1);
      const position=p.move?.start??last?.position??o.position;
      const end=p.move?.end??position;
      const yawStart=p.rotate?.start??yaw(position,end)??last?.yaw??o.rotation[1];
      const visible=p.show?.start??last?.visible??true;
      const action=o.kind==='car'?'drive':'hold';
      if(!last && start>0)addKey(o.id,action,{time:0,position:o.position,yaw:o.rotation[1],visible:true});
      addKey(o.id,action,{time:start,position,yaw:yawStart,visible});
      addKey(o.id,action,{time:clock,position:end,yaw:p.rotate?.end??yawStart,visible:p.show?.end??visible});
    }
    const c=s.camera;
    const actor=objects.find(o=>o.id===(c.target??c.attach_to)&&o.kind==='character');
    const resolve=(p:z.infer<typeof aim>|undefined):V3=>{
      if(Array.isArray(p))return p;
      const o=objects.find(v=>v.id===p);
      return o?plus(o.position,[0,o.size[1]*.7,0]):[0,1,0];
    };
    const tracking=c.mode!=='free'&&actor;
    const pos=tracking?plus(actor.position,c.offset??[0,1.5,.2]):c.start?.pos??[-4,3,-6];
    const target=tracking?plus(actor.position,c.look_at_offset??[0,1,3]):resolve(c.start?.look_at);
    const id='camera-'+cameras.length;
    cameras.push({
      id,name:friendly(s.id),position:pos,target,actorId:tracking?actor.id:undefined,roll:0,
      fov:Math.max(10,Math.min(130,2*Math.atan(18/c.lens_mm)*180/Math.PI)),
      keys:!tracking&&c.end?[{time:start,position:pos,target},{time:clock,position:c.end.pos,target:resolve(c.end.look_at??c.start?.look_at)}]:[],
    });
    return {id:s.id,name:friendly(s.id),cameraId:id,start,duration:s.duration,prompt:s.action};
  });
  return projectSchema.parse({
    version:3,id:scene.id,title:friendly(scene.id),fps:scene.fps,script:old.assumptions.join('\n')+'\n\n'+old.shots.map(s=>s.action).join('\n'),
    stage:{bounds:[set.bounds.width,set.bounds.height,set.bounds.depth],objects},
    tracks:[...tracks.values()].map(t=>({...t,keys:orderKeys(t.keys)})),cameras,shots,
  });
}
