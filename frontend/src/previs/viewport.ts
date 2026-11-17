import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneRig } from 'three/addons/utils/SkeletonUtils.js';
import { getAsset } from './scene/catalog';
import { renderAssembly } from './scene/render-model';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { SoftwareRenderer } from './software';
import { cameraState, objectState, type Project, type StageObject, type Shot, type V3, type Pass, type View } from './project';

export type Target = {kind:'object'|'path'|'camera'; id:string; index?:number};
export type ResultTransform = {position:V3; rotation:V3; scale:V3};
const near=.04, far=95;
const rads = Math.PI/180;
const edges = [[0,1],[1,2],[2,3],[3,4],[1,5],[5,6],[6,7],[1,8],[8,9],[9,10],[1,11],[11,12],[12,13],[0,14],[0,15],[14,16],[15,17]];
const poseColors = ['#ff5454','#ffa84b','#ffdc4c','#a4ef75','#44dba5','#43bec7','#629cf5','#7569ef','#ac6eeb','#e664b9'];
const material=(color:string)=>new T.MeshStandardMaterial({color,roughness:.79});
const background=new T.Color('#272d34');
type Rig={clips:T.AnimationClip[];mixer:T.AnimationMixer;active:string|null};
const rigs=new WeakMap<T.Object3D,Rig>();
function box(g:T.Object3D,x:number,y:number,z:number,w:number,h:number,d:number,color:string) {
  const mesh=new T.Mesh(new T.BoxGeometry(w,h,d),material(color));
  mesh.position.set(x,y,z); g.add(mesh); return mesh;
}
function sphere(g:T.Object3D,x:number,y:number,z:number,w:number,h:number,d:number,color:string,detail=0) {
  const mesh=new T.Mesh(new T.IcosahedronGeometry(.5,detail),material(color));
  mesh.scale.set(w,h,d);mesh.position.set(x,y,z);g.add(mesh);return mesh;
}
function cylinder(g:T.Object3D,x:number,y:number,z:number,r1:number,r2:number,h:number,color:string,segments=10) {
  const mesh=new T.Mesh(new T.CylinderGeometry(r1,r2,h,segments),material(color));
  mesh.position.set(x,y,z); g.add(mesh);return mesh;
}

function build(o:StageObject, asset?: T.Object3D) {
  const g = new T.Group();
  const [w,h,d] = o.size;
  const c = o.color;
  if(o.model&&!asset){g.add(renderAssembly(o.model,o.size,c));return g;}
  switch(o.kind) {
    case 'road':
      box(g,0,h/2,0,w,h,d,c);
      for(let z=-d/2+2; z<d/2-1; z+=4) box(g,0,h+.002,z,.095,.012,2.12,'#9e9a7e');
      for(const side of [-1,1]) box(g,side*(w/2-.1),h+.002,0,.05,.014,d,'#7c8588');
      break;
    case 'sidewalk':
      box(g,0,h/2,0,w,h,d,c);
      for(let z=-d/2+1;z<d/2;z+=2) box(g,0,h+.002,z,w,.011,.024,'#626c74');
      break;
    case 'tree':
      cylinder(g,0,h*.25,0,w*.053,w*.082,h*.52,'#5b4d41',7);
      sphere(g,0,h*.7,0,w*.89,h*.64,d,c,1);
      sphere(g,w*.23,h*.65,d*.16,w*.63,h*.42,d*.67,c,0);
      sphere(g,-w*.21,h*.58,-d*.09,w*.65,h*.41,d*.58,c,0);
      break;
    case 'lamp': {
      cylinder(g,0,h*.45,0,.035,.06,h*.9,c,8);
      const arm=cylinder(g,-w*.29,h*.91,0,.033,.033,w*.65,c,8);
      arm.rotation.z=Math.PI/2;
      box(g,-w*.61,h*.91,0,w*.41,.09,d*.67,'#596168');
      const bulb=box(g,-w*.61,h*.895,0,w*.28,.027,d*.46,'#e8b877');
      bulb.material.emissive.set('#e8ab65'); bulb.material.emissiveIntensity=.75;
      break;
    }
    case 'building':
      box(g,0,h/2,0,w,h,d,c);
      box(g,0,h+.02,0,w*1.015,.10,d*1.015,'#84909a');
      for(const side of [-1,1]) for(let row=1;row<h-0.5;row+=1.18) for(let z=-d/2+.75;z<d/2-.5;z+=1.16) {
        box(g,side*(w/2+.013),row,z,.034,.55,.53,Math.round(row+z*2)%5===0?'#a68b74':'#414b58');
      }
      break;
    case 'car': {
      const wheelY=h*.19, wheel=h*.36;
      box(g,0,h*.34,0,w*.94,h*.36,d*.965,c);
      box(g,0,h*.19,0,w*.79,h*.10,d*.83,'#383b44');
      box(g,0,h*.55,-d*.04,w*.74,h*.3,d*.48,c);
      box(g,0,h*.66,-d*.03,w*.70,h*.17,d*.43,'#343c48');
      box(g,0,h*.761,-d*.06,w*.69,h*.072,d*.36,c);
      box(g,0,h*.19,0,w*.76,h*.11,d*.80,'#292d34');
      for(const side of [-1,1]) {
        for(const z of [-.32,.32]) {
          const outer=cylinder(g,side*w*.46,wheelY,z*d,wheel/2,wheel/2,w*.13,'#292c33',16);
          outer.rotation.z=Math.PI/2;
          const rim=cylinder(g,side*w*.532,wheelY,z*d,wheel*.29,wheel*.29,.025,'#69717c',12);
          rim.rotation.z=Math.PI/2;
        }
        box(g,side*w*.30,h*.43,d*.488,w*.23,h*.10,.025,'#e6e0bd');
        box(g,side*w*.31,h*.40,-d*.488,w*.22,h*.10,.03,'#cb5751');
      }
      break;
    }
    case 'character': {
      if(asset){
        const actorModel=build({...o,kind:'asset'},asset);
        g.add(actorModel);
        const rig=rigs.get(actorModel);
        if(rig)rigs.set(g,rig);
      }
      g.userData.actor = {head:sphere(g,0,0,0,w*.34,h*.14,w*.34,'#ba9781',1), bones:edges.slice(0,13).map((_,i)=>cylinder(g,0,0,0,i===0?.065:i===1?.13:.04,i===1?.12:.04,1,i<=1?c:i>6?'#35434d':'#bf9d89',8))};
      if(asset){g.userData.actor.head.visible=false;for(const bone of g.userData.actor.bones)bone.visible=false;}
      break;
    }
    case 'sphere': sphere(g,0,h/2,0,w,h,d,c,2);break;
    case 'table':
      box(g,0,h*.92,0,w,h*.16,d,c);
      for(const x of [-.38,.38]) for(const z of [-.38,.38]) box(g,x*w,h*.43,z*d,w*.075,h*.86,d*.075,c);
      break;
    case 'chair':
      box(g,0,h*.51,0,w,h*.11,d,c); box(g,0,h*.74,-d*.41,w,h*.52,d*.13,c);
      for(const x of [-.37,.37]) for(const z of [-.37,.37]) box(g,x*w,h*.24,z*d,w*.10,h*.48,d*.10,c);
      break;
    case 'asset':
      if(asset) {
        const copy=cloneRig(asset);
        copy.traverse(item=>{if(item instanceof T.Mesh){item.geometry=item.geometry.clone();item.material=Array.isArray(item.material)?item.material.map(m=>m.clone()):item.material.clone();}});
        const bounds=new T.Box3().setFromObject(copy);
        if(!bounds.isEmpty()) {
          const dim=bounds.getSize(new T.Vector3()), center=bounds.getCenter(new T.Vector3());
          copy.position.sub(new T.Vector3(center.x,bounds.min.y,center.z));
          const holder=new T.Group(); holder.add(copy);
          holder.scale.set(w/Math.max(.001,dim.x),h/Math.max(.001,dim.y),d/Math.max(.001,dim.z));
          g.add(holder);
          if(asset.animations.length)rigs.set(g,{clips:asset.animations,mixer:new T.AnimationMixer(copy),active:null});
        }
      } else box(g,0,h/2,0,w,h,d,c);
      break;
    default:box(g,0,h/2,0,w,h,d,c);
  }
  return g;
}

function joints(o:StageObject,t:number,action:string,moving:boolean) {
  const [w,h]=o.size;
  const phase=t*(action==='jog'?16:10);
  const swing=moving && (action==='jog'||action==='walk')? Math.sin(phase)*h*(action==='jog'?.165:.11):0;
  const sit=action==='sit';
  const y=sit?h*.25:0;
  const j=(x:number,z:number,q:number)=>new T.Vector3(x*w,z*h,q*h);
  return [
    j(0,.914-y/h,.045),j(0,.78-y/h,0),
    j(-.31,.75-y/h,0),j(-.40,.61-y/h,swing/h*.52),j(-.39,.47-y/h,swing/h),
    j(.31,.75-y/h,0),j(.40,.61-y/h,-swing/h*.52),j(.39,.47-y/h,-swing/h),
    j(-.16,.52-y/h,0),j(-.18,sit?.24:.25,sit?.21:-swing/h*.7),j(-.18,.04,sit?.21:-swing/h),
    j(.16,.52-y/h,0),j(.18,sit?.24:.25,sit?.21:swing/h*.7),j(.18,.04,sit?.21:swing/h),
    j(-.047,.947-y/h,.042),j(.047,.947-y/h,.042),j(-.12,.927-y/h,0),j(.12,.927-y/h,0),
  ];
}

function dispose(g:T.Object3D) {
  g.traverse(o=>{if(o instanceof T.Mesh||o instanceof T.Line){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});
}
const vec=(x:T.Vector3):V3=>[x.x,x.y,x.z];
const linearShader = new T.ShaderMaterial({
  uniforms:{nearM:{value:near},farM:{value:far}},
  vertexShader:`
    #include <common>
    #include <skinning_pars_vertex>
    varying float d;
    void main(){
      #include <begin_vertex>
      #include <skinbase_vertex>
      #include <skinning_vertex>
      vec4 p=modelViewMatrix*vec4(transformed,1.);
      d=-p.z;
      gl_Position=projectionMatrix*p;
    }`,
  fragmentShader:'uniform float nearM;uniform float farM;varying float d;void main(){float z=1.-clamp((d-nearM)/(farM-nearM),0.,1.);gl_FragColor=vec4(vec3(z),1.);}',
});
const normalShader = new T.ShaderMaterial({
  vertexShader:'varying vec3 n;void main(){n=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader:'varying vec3 n;void main(){gl_FragColor=vec4(normalize(n)*.5+.5,1.);}',
});
const clayMaterial=new T.MeshStandardMaterial({color:'#9ba1a7',roughness:.86});


export class Viewport {
  world=new T.Scene();
  editable=new T.Group();
  helpers=new T.Scene();
  orbitCam=new T.PerspectiveCamera(48,1,.08,350);
  shotCam=new T.PerspectiveCamera(54,9/16,near,far);
  renderer:T.WebGLRenderer|SoftwareRenderer;
  cameraRenderer:T.WebGLRenderer|SoftwareRenderer;
  software=false;
  private dirty=true;
  private lastDraw=0;
  orbit:OrbitControls;
  gizmo:TransformControls;
  geometry=new Map<string,T.Group>();
  assets=new Map<string,T.Object3D>();
  private loadingAssets=new Map<string,Promise<void>>();
  points: {node:T.Object3D; target:Target}[]=[];
  output:HTMLCanvasElement;
  poseCanvas:HTMLCanvasElement;
  state!:Project;
  selected:Target|null=null;
  mode:View='stage';
  grid:T.GridHelper;
  axes:T.AxesHelper;
  helperDetail=new T.Group();
  marker:T.BoxHelper|null=null;
  onPick:(v:Target|null)=>void=()=>{};
  onTransform:(target:Target,v:ResultTransform)=>void=()=>{};
  progress=0;
  private startXY=[0,0];
  private ignorePickUntil=0;
  private lastTime=0;
  private lastShot:Shot|null=null;
  private lastPass:Pass|'scene'='scene';
  private resize:ResizeObserver;
  private raf=0;
  private dead=false;
  private activeCapture:T.WebGLRenderer|SoftwareRenderer|null=null;

  constructor(private worldHost:HTMLElement, private cameraHost:HTMLElement) {
    const supports=!!document.createElement('canvas').getContext('webgl2');
    this.software=!supports;
    this.renderer=supports?new T.WebGLRenderer({antialias:true,alpha:false}):new SoftwareRenderer(640);
    this.cameraRenderer=supports?new T.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true}):new SoftwareRenderer(510);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.65));
    this.cameraRenderer.setPixelRatio(Math.min(devicePixelRatio,1.65));
    this.output=this.cameraRenderer.domElement;
    this.poseCanvas=document.createElement('canvas');
    this.poseCanvas.hidden=true;
    worldHost.append(this.renderer.domElement);
    cameraHost.append(this.output,this.poseCanvas);
    this.world.background=background;
    this.world.add(this.editable,new T.HemisphereLight('#eff1ff','#5f554a',2.02));
    const light=new T.DirectionalLight('#fff2df',2.26);
    light.position.set(-9,19,8); this.world.add(light);
    const fill=new T.DirectionalLight('#a3c8f9',.92);fill.position.set(3,7,-21);this.world.add(fill);
    this.grid=new T.GridHelper(120,120,'#59626b','#363d46');
    this.grid.position.y=-.168;
    this.axes=new T.AxesHelper(3);this.axes.visible=false;
    this.helpers.add(this.grid,this.axes,this.helperDetail);
    this.orbit = new OrbitControls(this.orbitCam,this.renderer.domElement);
    this.orbit.enableDamping=true;
    this.orbit.addEventListener('change',()=>{this.dirty=true;});
    this.orbit.minDistance=1; this.orbit.maxDistance=170;
    this.gizmo = new TransformControls(this.orbitCam,this.renderer.domElement);
    this.gizmo.setSize(.72);
    this.gizmo.addEventListener('change',()=>{this.dirty=true;});
    this.helpers.add(this.gizmo.getHelper());
    this.gizmo.addEventListener('dragging-changed', event=>{
      this.orbit.enabled=!event.value;
      if(!event.value)this.ignorePickUntil=performance.now()+80;
    });
    this.gizmo.addEventListener('mouseUp',()=>{
      const node=this.gizmo.object, target=this.selected;
      if(node&&target) this.onTransform(target,{position:vec(node.position),rotation:vec(new T.Vector3(node.rotation.x/rads,node.rotation.y/rads,node.rotation.z/rads)),scale:vec(node.scale)});
    });
    this.renderer.domElement.addEventListener('pointerdown',this.down);
    this.renderer.domElement.addEventListener('pointerup',this.up);
    this.resize=new ResizeObserver(()=>this.fit());
    this.resize.observe(worldHost); this.resize.observe(cameraHost);
    this.view('Perspective');
    this.fit();
    this.draw();
  }
  private down=(event:PointerEvent)=>{this.startXY=[event.clientX,event.clientY];};
  private up=(event:PointerEvent)=>{
    if(event.button!==0||this.gizmo.dragging||performance.now()<this.ignorePickUntil||this.gizmo.axis||Math.hypot(event.clientX-this.startXY[0],event.clientY-this.startXY[1])>5)return;
    const box=this.renderer.domElement.getBoundingClientRect();
    const pointer=new T.Vector2((event.clientX-box.left)/box.width*2-1,-(event.clientY-box.top)/box.height*2+1);
    const caster=new T.Raycaster(); caster.setFromCamera(pointer,this.orbitCam);
    const matches=caster.intersectObjects([...this.points.map(o=>o.node),...this.geometry.values()],true);
    for(const match of matches) {
      let obj:T.Object3D|null=match.object;
      while(obj) {
        const target=obj.userData.target as Target|undefined;
        if(target && obj.visible) {this.onPick(target);return;}
        obj=obj.parent;
      }
    }
  };
  invalidate(){this.dirty=true;}
  private fit() {
    this.dirty=true;
    const [w,h]=[this.worldHost.clientWidth,this.worldHost.clientHeight];
    if(w>0&&h>0){this.renderer.setSize(w,h,false);this.orbitCam.aspect=w/h;this.orbitCam.updateProjectionMatrix();}
    const cw=Math.min(this.cameraHost.clientWidth,Math.floor(this.cameraHost.clientHeight*9/16));
    if(cw>0){
      const ch=Math.round(cw*16/9);
      this.cameraRenderer.setSize(cw,ch);
      this.poseCanvas.width=cw;this.poseCanvas.height=ch;
      this.poseCanvas.style.width=cw+'px';this.poseCanvas.style.height=ch+'px';
    }
  }
  private draw=()=>{
    if(this.dead)return;
    this.raf=requestAnimationFrame(this.draw);
    this.orbit.update();
    if(this.software&&(!this.dirty||performance.now()-this.lastDraw<35))return;
    this.lastDraw=performance.now();this.dirty=false;
    if(this.mode==='stage'&&this.lastShot)this.evaluate(this.lastTime,true);
    this.marker?.update();
    this.renderer.autoClear=true;
    this.renderer.render(this.world,this.orbitCam);
    this.renderer.autoClear=false;
    this.renderer.render(this.helpers,this.orbitCam);
    if(this.renderer instanceof SoftwareRenderer){
      for(const point of this.points)this.renderer.marker(point.node.position,this.orbitCam,point.target.kind==='camera'?'#bfa3f5':'#ff996e');
      if(this.gizmo.object)this.renderer.drawGizmo(this.gizmo.object.position,this.orbitCam,this.gizmo.getMode());
    }
    if(this.lastShot){
      if(this.mode==='stage')this.evaluate(this.lastTime);
      this.renderPreview();
    }
  };
  configure(p:Project) {
    this.state=p;this.dirty=true;
    this.gizmo.detach();
    for(const item of [...this.editable.children]){this.editable.remove(item);dispose(item);}
    this.geometry.clear();
    const ground=box(this.editable,0,-.25,0,p.stage.bounds[0]+6,.12,p.stage.bounds[2]+3,'#424951');
    ground.userData.base=true;
    for(const o of p.stage.objects) {
      const g=build(o,o.assetId?this.assets.get(o.assetId):undefined);
      g.userData.target={kind:'object',id:o.id};
      this.geometry.set(o.id,g);
      this.editable.add(g);
    }
    this.rebuildHelpers();
    if(this.lastShot)this.show(p.shots.find(s=>s.id===this.lastShot?.id)??p.shots[0],this.lastTime,this.lastPass);
  }
  async loadBuiltin(id:string){
    if(this.assets.has(id))return;
    const asset=getAsset(id);
    if(!asset)return;
    let pending=this.loadingAssets.get(id);
    if(!pending){
      pending=(async()=>{
        const response=await fetch(import.meta.env.BASE_URL+asset.path);
        if(!response.ok)throw Error('Local model unavailable: '+asset.name);
        await this.loadAsset(id,await response.blob());
      })().finally(()=>{this.loadingAssets.delete(id);});
      this.loadingAssets.set(id,pending);
    }
    await pending;
  }
  async loadAsset(id:string,blob:Blob,deps:Record<string,Blob>={}) {
    const manager=new T.LoadingManager();
    const urls:Record<string,string>={};
    for(const [key,value] of Object.entries(deps))urls[key]=URL.createObjectURL(value);
    manager.setURLModifier(url=>{
      if(url.startsWith('data:')||url.startsWith('blob:'))return url;
      const found=urls[url]??Object.entries(urls).find(([key])=>url.endsWith('/'+key))?.[1];
      if(!found)throw Error('Missing model dependency: '+url);
      return found;
    });
    try{
      const model=await new GLTFLoader(manager).parseAsync(await blob.arrayBuffer(),'');
      model.scene.animations=model.animations;
      const dim=new T.Box3().setFromObject(model.scene).getSize(new T.Vector3());
      if(!this.dead){this.assets.set(id,model.scene);if(this.state)this.configure(this.state);}
      return [dim.x,dim.y,dim.z].map(n=>Math.max(.01,Math.min(1000,n))) as V3;
    }finally{for(const u of Object.values(urls))URL.revokeObjectURL(u);}
  }
  dropPosition(clientX:number,clientY:number):V3 {
    const rect=this.renderer.domElement.getBoundingClientRect();
    const xy=new T.Vector2((clientX-rect.left)/rect.width*2-1,-(clientY-rect.top)/rect.height*2+1);
    const ray=new T.Raycaster();ray.setFromCamera(xy,this.orbitCam);
    const pos=ray.ray.intersectPlane(new T.Plane(new T.Vector3(0,1,0),0),new T.Vector3());
    return pos?vec(pos):[0,0,0];
  }
  setMode(mode:View){this.mode=mode;this.rebuildHelpers();}
  setSelection(target:Target|null){this.selected=target;this.attach();}
  view(label:string) {
    const size=this.state?Math.min(2.8,Math.max(.45,this.state.stage.bounds[2]/64)):1;
    const offsets:Record<string,V3>={Perspective:[15,28,28],Top:[0,60,.01],Front:[0,5,42],Side:[49,5,0]};
    this.orbitCam.position.fromArray(offsets[label].map(n=>n*size) as V3);
    this.orbit.target.set(0,.5,0);this.orbit.update();
  }
  setTransform(mode:'translate'|'rotate'|'scale', snap:boolean){
    this.gizmo.setMode(this.mode==='blocking'?'translate':mode);
    this.gizmo.setTranslationSnap(snap?.25:null);
    this.gizmo.setRotationSnap(snap?15*rads:null);
    this.gizmo.setScaleSnap(snap?.1:null);
  }
  private rebuildHelpers(){
    this.dirty=true;this.gizmo.detach();this.marker=null;
    for(const item of [...this.helperDetail.children]){this.helperDetail.remove(item);dispose(item);}
    this.points=[];
    if(!this.state)return;
    if(this.mode!=='stage')for(const track of this.state.tracks){
      const color=track.action==='drive'?'#84a5f4':'#f28a5f';
      const verts=track.keys.map(k=>new T.Vector3(...k.position).add(new T.Vector3(0,.06,0)));
      this.helperDetail.add(new T.Line(new T.BufferGeometry().setFromPoints(verts),new T.LineBasicMaterial({color,transparent:true,opacity:.92,depthTest:false})));
      if(this.mode==='blocking') track.keys.forEach((k,index)=>{
        const node=new T.Mesh(new T.SphereGeometry(.14,9,7),new T.MeshBasicMaterial({color,depthTest:false}));
        const target:Target={kind:'path',id:track.objectId,index};
        node.userData.target=target;
        node.position.fromArray(k.position);this.helperDetail.add(node);this.points.push({node,target});
      });
    }
    if(this.mode==='cameras') for(const c of this.state.cameras) {
      const marker=new T.Mesh(new T.BoxGeometry(.36,.28,.28),new T.MeshBasicMaterial({color:'#b6a0f0',wireframe:true,depthTest:false}));
      const target:Target={kind:'camera',id:c.id};
      marker.userData.target=target;marker.position.fromArray(c.position);this.helperDetail.add(marker);this.points.push({node:marker,target});
      const pos=c.keys.map(k=>new T.Vector3(...k.position));
      if(pos.length>1)this.helperDetail.add(new T.Line(new T.BufferGeometry().setFromPoints(pos),new T.LineBasicMaterial({color:'#b6a0f0',depthTest:false})));
      const aim=new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(...c.position),new T.Vector3(...c.target)]),new T.LineDashedMaterial({color:'#9880cc',dashSize:.24,gapSize:.16,depthTest:false}));
      aim.computeLineDistances(); this.helperDetail.add(aim);
    }
    this.attach();
  }
  private attach(){
    this.dirty=true;this.gizmo.detach();
    if(this.marker){this.helperDetail.remove(this.marker);dispose(this.marker);this.marker=null;}
    if(!this.selected||!this.state)return;
    const s=this.selected;
    if(s.kind==='object'){
      const o=this.state.stage.objects.find(v=>v.id===s.id), node=this.geometry.get(s.id);
      if(node&&o?.visible){
        this.marker=new T.BoxHelper(node,'#ff8b62'); this.helperDetail.add(this.marker);
        if(this.mode==='stage'&&!o.locked)this.gizmo.attach(node);
      }
    }else{
      const item=this.points.find(i=>i.target.kind===s.kind&&i.target.id===s.id&&i.target.index===s.index);
      if(item){this.gizmo.setMode('translate');this.gizmo.attach(item.node);}
    }
  }
  private evaluate(time:number,base=false) {
    for(const o of this.state.stage.objects){
      const node=this.geometry.get(o.id);
      if(!node)continue;
      const tr=this.state.tracks.find(x=>x.objectId===o.id);
      const moving=objectState(o,tr,time);
      node.visible=base?o.visible:moving.visible;
      if(!(this.gizmo.dragging&&this.gizmo.object===node)){
        node.position.fromArray(base?o.position:moving.position);
        node.rotation.fromArray((base?o.rotation:moving.rotation).map(x=>x*rads) as V3);
        node.scale.fromArray(o.scale);
      }
      const rig=rigs.get(node);
      if(rig){
        const defaults=o.assetId?getAsset(o.assetId)?.actions:undefined;
        const action=tr?.action??'hold';
        const desired=base?undefined:tr?.modelClip??o.modelClip??defaults?.[moving.active?action:action==='walk'||action==='jog'?'hold':action];
        const clip=rig.clips.find(c=>c.name===desired);
        if(rig.active!==(clip?.name??null)){
          rig.mixer.stopAllAction();
          if(clip)rig.mixer.clipAction(clip).play();
          rig.active=clip?.name??null;
        }
        if(clip)rig.mixer.setTime(Math.max(0,time-(tr?.keys[0].time??0))*(action==='jog'&&o.assetId==='cesium-worker'?1.6:1));
      }
      if(o.kind==='character'){
        const points=joints(o,time,tr?.action??'hold',moving.active);
        node.userData.points=points;
        const {head,bones}=node.userData.actor as {head:T.Mesh;bones:T.Mesh[]};
        head.position.copy(points[0]);
        const up=new T.Vector3(0,1,0);
        for(const [i,bone] of bones.entries()){
          const [a,b]=edges[i].map(j=>points[j]);
          const direction=b.clone().sub(a);
          bone.position.copy(a).lerp(b,.5);bone.scale.y=direction.length();
          bone.quaternion.setFromUnitVectors(up,direction.normalize());
        }
      }
    }
    this.world.updateMatrixWorld(true);
  }
  private configureCamera(shot:Shot,t:number,aspect:number) {
    const c=cameraState(this.state,shot,t);
    this.shotCam.position.fromArray(c.position);this.shotCam.fov=c.fov;this.shotCam.aspect=aspect;
    this.shotCam.lookAt(...c.target);this.shotCam.rotateZ(c.roll*rads);this.shotCam.updateProjectionMatrix();this.shotCam.updateMatrixWorld(true);
    return c;
  }
  show(shot:Shot,t:number,pass:Pass|'scene'){
    if(!this.state)return;
    this.lastShot=shot;this.lastTime=t;this.lastPass=pass;this.dirty=true;
    this.evaluate(t);
  }
  private pose(target:HTMLCanvasElement, w:number,h:number,draw:boolean) {
    const projected:{id:string; keypoints:number[][]}[]=[];
    const ctx=draw?target.getContext('2d'):null;
    if(ctx){ctx.fillStyle='#000';ctx.fillRect(0,0,w,h);ctx.lineWidth=Math.max(1.8,w/160);ctx.lineCap='round';}
    for(const [id,g] of this.geometry){
      if(!g.userData.points||!g.visible)continue;
      const points=(g.userData.points as T.Vector3[]).map(pt=>{
        const world=g.localToWorld(pt.clone());
        const eye=world.clone().applyMatrix4(this.shotCam.matrixWorldInverse);
        const n=world.project(this.shotCam);
        return [(n.x+1)*w/2,(1-n.y)*h/2,eye.z<-near&&Math.abs(n.x)<=1&&Math.abs(n.y)<=1?1:0];
      });
      projected.push({id,keypoints:points.map(([x,y,v])=>v?[+x.toFixed(2),+y.toFixed(2),1]:[0,0,0])});
      if(ctx){
        for(const [i,[a,b]] of edges.entries()){
          if(!points[a][2]||!points[b][2])continue;
          ctx.strokeStyle=poseColors[i%poseColors.length];ctx.beginPath();ctx.moveTo(points[a][0],points[a][1]);ctx.lineTo(points[b][0],points[b][1]);ctx.stroke();
        }
        for(const [i,[x,y,v]] of points.entries()){
          if(!v)continue;ctx.fillStyle=poseColors[i%poseColors.length];ctx.beginPath();ctx.arc(x,y,Math.max(1.7,w/140),0,Math.PI*2);ctx.fill();
        }
      }
    }
    return projected;
  }
  private render(view:T.WebGLRenderer|SoftwareRenderer,pass:Pass|'scene') {
    if(view instanceof SoftwareRenderer){view.mode=pass;view.render(this.world,this.shotCam);return;}
    const bg=this.world.background;
    if(pass==='depth'||pass==='normal')this.world.background=new T.Color(0);
    this.world.overrideMaterial=pass==='depth'?linearShader:pass==='normal'?normalShader:pass==='clay'?clayMaterial:null;
    view.render(this.world,this.shotCam);
    this.world.overrideMaterial=null;this.world.background=bg;
  }
  private renderPreview() {
    this.configureCamera(this.lastShot!,this.lastTime,9/16);
    const pose=this.lastPass==='pose';
    this.poseCanvas.hidden=!pose;
    this.output.hidden=pose;
    if(pose)this.pose(this.poseCanvas,this.poseCanvas.width,this.poseCanvas.height,true);
    else this.render(this.cameraRenderer,this.lastPass);
  }
  capture(shot:Shot,time:number,w:number,h:number,passes:(Pass|'scene')[]) {
    this.activeCapture??=this.software?new SoftwareRenderer(2048):new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
    const r=this.activeCapture;
    r.setSize(w,h,false);
    this.evaluate(time); const c=this.configureCamera(shot,time,w/h);
    const poseCanvas=document.createElement('canvas');poseCanvas.width=w;poseCanvas.height=h;
    const pose=this.pose(poseCanvas,w,h,passes.includes('pose'));
    const frames=Object.fromEntries(passes.map(pass=>{
      if(pass==='pose')return [pass,poseCanvas.toDataURL()];
      this.render(r,pass);
      return [pass,r.domElement.toDataURL()];
    }));
    const camera={position:c.position,target:c.target,fov:c.fov,roll:c.roll,view:this.shotCam.matrixWorldInverse.toArray(),projection:this.shotCam.projectionMatrix.toArray(),near,far};
    if(this.lastShot)this.evaluate(this.lastTime);
    return {frames,camera,pose};
  }
  releaseCapture(){this.activeCapture?.dispose();this.activeCapture?.forceContextLoss();this.activeCapture=null;}
  async glb(){
    const exporter=new GLTFExporter();
    this.evaluate(this.lastTime,true);
    try{return await exporter.parseAsync(this.editable,{binary:true,onlyVisible:true}) as ArrayBuffer;}
    finally{this.evaluate(this.lastTime);}
  }
  destroy() {
    this.dead=true;cancelAnimationFrame(this.raf);this.resize.disconnect();
    this.gizmo.detach();this.gizmo.dispose();this.orbit.dispose();
    this.renderer.domElement.removeEventListener('pointerdown',this.down);
    this.renderer.domElement.removeEventListener('pointerup',this.up);
    this.renderer.dispose();this.cameraRenderer.dispose();this.releaseCapture();
    this.renderer.forceContextLoss();this.cameraRenderer.forceContextLoss();
    dispose(this.editable);dispose(this.helpers);for(const asset of this.assets.values())dispose(asset);
    this.renderer.domElement.remove();this.output.remove();this.poseCanvas.remove();
  }
}
