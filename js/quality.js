import {setShellCount} from './fur.js';

const tiers=[{layers:14,dpr:2,a:1,b:true,shadow:true},{layers:10,dpr:1.5,a:1,b:true,shadow:true},{layers:6,dpr:1.25,a:.7,b:false,shadow:true},{layers:0,dpr:1,a:.35,b:false,shadow:false}];
export class Quality {
  constructor(renderer,light,parts,mobile){
    this.renderer=renderer;this.light=light;this.parts=parts;this.mobile=mobile;
    const value=new URLSearchParams(location.search).get('palier');
    this.forced=value!==null&&/^[0-3]$/.test(value);
    this.level=this.forced?Number(value):mobile?2:0;
    this.samples=[];this.fps=0;this.started=performance.now();this.lastChange=this.started;this.apply();
  }
  apply(){
    const tier=tiers[this.level];this.targetRatio=Math.min(devicePixelRatio,tier.dpr,this.mobile?1.5:2);
    if(!this.ratio){this.ratio=this.targetRatio;this.renderer.setPixelRatio(this.ratio);}
    this.light.castShadow=tier.shadow;
    for(const p of this.parts){
      if(p.shell)setShellCount(p.shell,this.mobile?Math.min(tier.layers,6):tier.layers);
      for(const hair of p.hairs){
        if(hair.userData.batch==='duvet'){hair.visible=this.level<3;continue;}
        hair.visible=hair.userData.batch==='a'||tier.b;
        const [start,count]=hair.userData.fullRange;
        const stride=hair.userData.indicesPerHair;
        hair.geometry.setDrawRange(start*stride,Math.floor(count*(hair.userData.batch==='a'?tier.a:1))*stride);
      }
    }
  }
  update(ms,now,dt){
    this.ratio+=(this.targetRatio-this.ratio)*(1-Math.pow(.935,dt*60));
    if(Math.abs(this.renderer.getPixelRatio()-this.ratio)>.04)this.renderer.setPixelRatio(this.ratio);
    if(document.hidden||now-this.started<3500)return;
    this.samples.push(Math.min(ms,150));if(this.samples.length<120)return;
    const average=this.samples.reduce((a,b)=>a+b,0)/this.samples.length;
    this.fps=1000/average;this.samples.length=0;
    if(this.forced||now-this.lastChange<5000)return;
    const slow=this.mobile?31:23;
    if(average>slow&&this.level<3){this.level++;this.apply();this.lastChange=now;}
    else if(average<17.5&&this.level>(this.mobile?2:0)&&now-this.lastChange>20000){this.level--;this.apply();this.lastChange=now;}
  }
}
