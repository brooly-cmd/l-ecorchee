import {setShellCount} from './fur.js';

const tiers=[
  {layers:14,a:1,b:true,shadow:1},
  {layers:10,a:1,b:true,shadow:1},
  {layers:6,a:1,b:false,shadow:1},
  {layers:4,a:1,b:false,shadow:1},
  {layers:3,a:1,b:false,shadow:1},
  {layers:3,a:30000/45716,b:false,shadow:1},
  {layers:2,a:30000/45716,b:false,shadow:1},
  {layers:2,a:20000/45716,b:false,shadow:1},
  {layers:1,a:16000/45716,b:false,shadow:1}
];
export class Quality {
  constructor(renderer,light,parts,mobile,integrated=false,batches=null){
    Object.assign(this,{renderer,light,parts,mobile,integrated,batches});
    const value=new URLSearchParams(location.search).get('palier');
    this.forced=value!==null&&/^[0-8]$/.test(value);
    // Missing B is an asset choice, never a GPU/device-name resolution limit.
    this.floor=parts.some(p=>p.hairs.some(h=>h.userData.batch==='b'))?0:2;
    this.level=this.forced?Number(value):this.floor;
    const gl=renderer.getContext();this.samples=gl.getParameter(gl.SAMPLES);
    // RGBA8 + depth/stencil per MSAA sample, plus three resolved colour buffers.
    // This is a conservative attachment estimate, NOT a claim to query free VRAM.
    this.bytesPerPixel=8*Math.max(1,this.samples)+12;
    this.bufferBudget=96*1024*1024;
    const maxSize=Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),gl.getParameter(gl.MAX_TEXTURE_SIZE),...gl.getParameter(gl.MAX_VIEWPORT_DIMS));
    const memoryDpr=Math.sqrt(this.bufferBudget/(innerWidth*innerHeight*this.bytesPerPixel));
    this.maxDpr=Math.min(devicePixelRatio,2.5,memoryDpr,maxSize/innerWidth,maxSize/innerHeight);
    this.resolutions=[this.maxDpr,...[2,1.75,1.5,1.25,1,.9,.75,.65,.5].filter(v=>v<this.maxDpr-.01)];
    this.resolution=0;
    this.fps=0;this.sum=0;this.count=0;this.calibration=[];this.locked=false;
    this.lastInput=-Infinity;this.pointers=new Set();this.detail=1;this.interacting=false;
    const relevant=e=>e.target.id==='scene'||e.target.id==='scalpel';
    addEventListener('pointerdown',e=>{if(relevant(e)){this.pointers.add(e.pointerId);this.lastInput=performance.now();}},{capture:true,passive:true});
    for(const event of ['pointerup','pointercancel'])addEventListener(event,e=>{if(this.pointers.delete(e.pointerId))this.lastInput=performance.now();},{capture:true,passive:true});
    addEventListener('blur',()=>this.pointers.clear());
    for(const event of ['input','wheel','keydown'])addEventListener(event,e=>{if(relevant(e))this.lastInput=performance.now();},{capture:true,passive:true});
    this.apply();
  }
  apply(){
    if(this.locked)return;
    const tier=tiers[this.level];
    // Allocation / resolution changes are confined to loading.
    const dpr=this.resolutions[this.resolution];
    if(this.renderer.getPixelRatio()!==dpr){this.renderer.setPixelRatio(dpr);this.onResolutionChange?.();}
    // Never toggle castShadow: this used to recompile every lit shader mid-drag.
    this.light.shadow.intensity=tier.shadow;
    // The supplied velvet skin stays opaque, dyed and matte at every reduced tier.
    // Keep the complete tier-0 material untouched, including its exact RTX response.
    const reduced=this.level>=2;
    const velvet=mesh=>{
      mesh.material.userData.reducedCoat.value=reduced?1:0;
      const m=mesh.material;
      if(!!m.defines?.REDUCED_COAT!==reduced){
        m.defines={...m.defines};if(reduced)m.defines.REDUCED_COAT=1;else delete m.defines.REDUCED_COAT;
        m.needsUpdate=true;
      }
      mesh.renderOrder=reduced?999:1002;
    };
    const matte=mesh=>{
      const m=mesh.material;
      if(!m.userData.fullCoat)m.userData.fullCoat={clearcoat:m.clearcoat,specularIntensity:m.specularIntensity};
      m.clearcoat=reduced?0:m.userData.fullCoat.clearcoat;
      m.specularIntensity=reduced?.12:m.userData.fullCoat.specularIntensity;
    };
    for(const p of this.parts)if(p.shell){velvet(p.shell);matte(p.body);}
    if(this.batches){
      if(this.batches.shell)velvet(this.batches.shell);
      for(const {mesh,items} of this.batches.bodies)if(items[0].shell)matte(mesh);
    }
    for(const p of this.parts)if(p.shell)setShellCount(p.shell,this.layers(tier));
    if(this.batches?.shell)setShellCount(this.batches.shell,this.layers(tier));
    this.setDetail();
  }
  layers(tier){return this.mobile?Math.min(tier.layers,6):tier.layers;}
  setDetail(){
    const tier=tiers[this.level];
    const shell=(mesh)=>{
      mesh.userData.detail.value=1;
      const layers=this.layers(tier);
      mesh.geometry.instanceCount=layers;
      mesh.userData.qualityVisible=layers>0;mesh.visible=layers>0;
    };
    const hair=(h)=>{
      const batch=h.userData.batch;
      if(batch==='duvet'){h.userData.qualityVisible=this.level<2;h.visible=h.userData.qualityVisible;return;}
      const [start,count]=h.userData.fullRange,stride=h.userData.indicesPerHair;
      const fraction=batch==='a'?tier.a:tier.b?1:0;
      if(h.userData.balancedIndex)h.geometry.setIndex(fraction<1?h.userData.balancedIndex:h.userData.completeIndex);
      h.geometry.setDrawRange(start*stride,Math.floor(count*fraction)*stride);
      h.userData.qualityVisible=fraction>0;h.visible=fraction>0;
    };
    for(const p of this.parts){if(p.shell)shell(p.shell);for(const h of p.hairs)hair(h);}
    if(this.batches){if(this.batches.shell)shell(this.batches.shell);for(const h of this.batches.hairs)hair(h);}
  }
  beginFrame(now,dt){
    this.interacting=this.pointers.size>0||now-this.lastInput<700;
  }
  async calibrate(draw){
    // Measure under the opaque veil, after compilation. Include GPU completion
    // and probe both the whole and cut views, rather than timing JS alone.
    // Leave room for touch delivery, the UI, section updates and thermal variation.
    const budget=23,ceiling=40;
    const probe=async(confirm)=>{
      const samples=[],scenarios=[];
      // Reject an expensive cut first; do not spend time measuring two easy views
      // after a candidate has already failed.
      for(const mode of [1,2,0]){
        const intervals=[];
        let previous=await new Promise(requestAnimationFrame);
        // Warm each moving view before sampling. RAF includes actual GPU pacing;
        // gl.finish alone measured submission, and startup uploads skewed short probes.
        // The very first batch upload can stall several frames even on RTX.
        // Exclude it once, then use short rejection probes and a longer confirmation.
        const firstUpload=!confirm&&!this.calibration.length&&scenarios.length===0;
        const warm=firstUpload?18:confirm?8:3,frames=warm+(confirm?60:12);
        for(let i=0;i<frames;i++){
          const now=await new Promise(requestAnimationFrame);
          if(this.renderer.getContext().isContextLost())throw Error('Contexte WebGL perdu pendant la mesure');
          if(i>=warm){samples.push(now-previous);intervals.push(now-previous);}previous=now;
          draw(mode,i/(frames-1));
        }
        const sorted=intervals.slice().sort((a,b)=>a-b);
        scenarios.push({mode,p95:sorted[Math.ceil(sorted.length*.95)-1],worst:sorted.at(-1),over50:sorted.filter(v=>v>50).length,intervals});
        if(scenarios.at(-1).p95>budget||scenarios.at(-1).worst>ceiling)break;
      }
      samples.sort((a,b)=>a-b);
      const p95=Math.max(...scenarios.map(s=>s.p95)),worst=samples.at(-1);
      const result={level:this.level,dpr:this.renderer.getPixelRatio(),confirm,p95,worst,scenarios,budget};
      this.calibration.push(result);return result;
    };
    const fits=r=>r.p95<=budget&&r.worst<=ceiling;
    let rejected=this.floor-1;
    for(;;){
      const quick=await probe(false);
      if(this.forced)break;
      if(fits(quick)){
        // At the chosen resolution, recover every affordable layer and strand.
        // Binary refinement also checks levels skipped by the fast rejection ladder.
        let low=rejected+1,high=this.level;
        while(low<high){
          this.level=Math.floor((low+high)/2);this.apply();
          if(fits(await probe(false)))high=this.level;else low=this.level+1;
        }
        this.level=high;this.apply();
        if(fits(await probe(true)))break;
      }
      // Spend fewer strands/layers BEFORE a single pixel of sharpness. Resolution
      // is chosen by these actual draws, identically on Intel, RTX, Apple and ARM.
      // A short ladder avoids spending several extra seconds proving adjacent
      // densities fail. Intermediate tiers remain available for visual checks.
      rejected=this.level;
      if(this.level<tiers.length-1)this.level=this.level<2?2:this.level<5?5:this.level<7?7:8;
      else if(this.resolution<this.resolutions.length-1){this.resolution++;rejected=this.floor-1;}
      else break;
      this.apply();
    }
    // The coat is locked until reload: no automatic upgrades or downgrades.
    this.locked=true;this.renderer.info.reset();
  }
  buffers(){
    const gl=this.renderer.getContext(),width=gl.drawingBufferWidth,height=gl.drawingBufferHeight;
    return {width,height,dpr:this.renderer.getPixelRatio(),screenDpr:devicePixelRatio,screenRatio:width/(innerWidth*devicePixelRatio),samples:this.samples,
      estimatedMiB:width*height*this.bytesPerPixel/1048576,budgetMiB:this.bufferBudget/1048576,intermediateTargets:0};
  }
  update(ms){
    if(document.hidden)return;
    this.sum+=ms;this.count++;
    if(this.count<120)return;
    const average=this.sum/this.count;this.fps=1000/average;this.sum=this.count=0;
  }
}
