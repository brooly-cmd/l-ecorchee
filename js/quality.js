import {setShellCount} from './fur.js';

const tiers=[{layers:14,dpr:2,a:1,b:true,shadow:1},{layers:10,dpr:1.5,a:1,b:true,shadow:1},{layers:6,dpr:1.25,a:.7,b:false,shadow:1},{layers:0,dpr:1,a:.35,b:false,shadow:0}];
export class Quality {
  constructor(renderer,light,parts,mobile,integrated=false,batches=null){
    Object.assign(this,{renderer,light,parts,mobile,integrated,batches});
    const value=new URLSearchParams(location.search).get('palier');
    this.forced=value!==null&&/^[0-3]$/.test(value);
    this.floor=mobile?3:integrated?2:0;this.level=this.forced?Number(value):this.floor;
    this.fps=0;this.sum=0;this.count=0;this.started=performance.now();this.lastChange=this.started;
    this.lastInput=-Infinity;this.pointers=new Set();this.detail=1;this.interacting=false;
    const relevant=e=>e.target.id==='scene'||e.target.id==='scalpel';
    addEventListener('pointerdown',e=>{if(relevant(e)){this.pointers.add(e.pointerId);this.lastInput=performance.now();}},{capture:true,passive:true});
    for(const event of ['pointerup','pointercancel'])addEventListener(event,e=>{if(this.pointers.delete(e.pointerId))this.lastInput=performance.now();},{capture:true,passive:true});
    addEventListener('blur',()=>this.pointers.clear());
    for(const event of ['input','wheel','keydown'])addEventListener(event,e=>{if(relevant(e))this.lastInput=performance.now();},{capture:true,passive:true});
    this.apply();
  }
  apply(){
    const tier=tiers[this.level];
    // Allocation / resolution changes are confined to loading or prolonged idle.
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,tier.dpr,this.mobile?1.5:2));
    this.onResolutionChange?.();
    // Never toggle castShadow: this used to recompile every lit shader mid-drag.
    this.light.shadow.intensity=tier.shadow;
    for(const p of this.parts)if(p.shell)setShellCount(p.shell,this.mobile?Math.min(tier.layers,6):tier.layers);
    if(this.batches?.shell)setShellCount(this.batches.shell,this.mobile?Math.min(tier.layers,6):tier.layers);
    this.setDetail(this.detail,true);
  }
  setDetail(detail,force=false){
    if(!force&&Math.abs(detail-this.appliedDetail)<.002)return;
    this.appliedDetail=detail;
    const tier=tiers[this.level],gestureA=this.mobile?.1:this.integrated?.12:.2;
    const a=gestureA+(tier.a-gestureA)*detail;
    const shell=(mesh)=>{
      mesh.userData.detail.value=detail;
      const layers=this.mobile?Math.min(tier.layers,6):tier.layers;
      mesh.geometry.instanceCount=layers?Math.max(1,Math.ceil(layers*detail)):0;
      mesh.userData.qualityVisible=layers>0;mesh.visible=layers>0;
    };
    const hair=(h)=>{
      const batch=h.userData.batch;
      if(batch==='duvet'){h.userData.qualityVisible=this.level<3&&detail>.98;h.visible=h.userData.qualityVisible;return;}
      const [start,count]=h.userData.fullRange,stride=h.userData.indicesPerHair;
      const fraction=batch==='a'?a:tier.b?detail:0;
      h.geometry.setDrawRange(start*stride,Math.floor(count*fraction)*stride);
      h.userData.qualityVisible=fraction>0;h.visible=fraction>0;
    };
    for(const p of this.parts){if(p.shell)shell(p.shell);for(const h of p.hairs)hair(h);}
    if(this.batches){if(this.batches.shell)shell(this.batches.shell);for(const h of this.batches.hairs)hair(h);}
  }
  beginFrame(now,dt){
    this.interacting=this.pointers.size>0||now-this.lastInput<700;
    // Restore strand density and layers over ~1.2 seconds, using the same compiled shaders.
    this.detail=this.interacting?0:Math.min(1,this.detail+dt/1.2);
    this.setDetail(this.detail);
  }
  update(ms,now){
    if(document.hidden||now-this.started<3500)return;
    this.sum+=ms;this.count++;
    if(this.count<120)return;
    const average=this.sum/this.count;this.fps=1000/average;this.sum=this.count=0;
    if(this.forced||this.interacting||this.detail<1||now-this.lastInput<5000||now-this.lastChange<10000)return;
    if(average>(this.mobile?30:24)&&this.level<3){this.level++;this.apply();this.lastChange=now;}
    else if(average<17&&this.level>this.floor&&now-this.lastChange>20000){this.level--;this.apply();this.lastChange=now;}
  }
}
