// Native easing fallback: offline, interruptible, expo.out / power3.out, >= .3 s.
// Values are still damped by the frame loop before reaching the model/camera.
export class Motion {
  constructor(){this.jobs=new Map();}
  to(key,object,values,duration=1.2,ease='expo.out',complete){
    const from={};for(const k in values)from[k]=object[k];
    this.jobs.set(key,{object,values,from,start:performance.now(),duration:duration*1000,ease,complete});
  }
  update(now){for(const [key,j] of this.jobs){const t=Math.max(0,Math.min(1,(now-j.start)/j.duration));const e=j.ease==='expo.out'?(t===1?1:1-Math.pow(2,-10*t)):1-Math.pow(1-t,4);for(const k in j.values)j.object[k]=j.from[k]+(j.values[k]-j.from[k])*e;if(t===1){this.jobs.delete(key);j.complete?.();}}}
  cancel(key){this.jobs.delete(key);}
}
