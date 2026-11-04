import * as T from 'three';
import {Motion} from './motion.js';

export class Anatomy {
  constructor(parts,plane,rig,sections){
    Object.assign(this,{parts,plane,rig,sections});this.motion=new Motion();
    this.state={cut:0,spread:0};this.axis='x';this.selected=null;this.isolated=false;this.exploded=false;
    this.bounds=[0,1,2].map(a=>[Math.min(...parts.map(p=>p.data.mini[a]))-.18,Math.max(...parts.map(p=>p.data.maxi[a]))+.18]);
    this.ray=new T.Raycaster();this.ndc=new T.Vector2();this.hits=[];this.focusPoint=new T.Vector3();
    this.offsetTarget=new T.Vector3();this.positionTarget=new T.Vector3();this.pickable=[];this.cutTarget=null;
  }
  gesture(){document.getElementById('invitation').classList.add('dismissed');}
  cut(value){
    // Input handlers store the latest target. Apply it once in the frame loop.
    this.queuedCut=T.MathUtils.clamp(value,0,1);
  }
  flushCut(){
    if(this.queuedCut===undefined)return;
    const value=this.queuedCut;this.queuedCut=undefined;
    this.gesture();this.pendingAxis=null;this.exploded=false;this.pendingCut=value;
    if(this.state.spread>.0001&&!this.motion.jobs.has('spread'))this.motion.to('spread',this.state,{spread:0},1.2);
    if(this.isolated){this.isolated=false;this.ui.card(this.selected,false);}
    if(this.state.spread<.001)this.startCut();
  }
  startCut(){
    const value=this.pendingCut;this.pendingCut=null;
    if(value>0&&this.rig.pose!=='cut')this.rig.section(this.axis);
    else if(value===0&&!this.selected)this.rig.frame();
    this.motion.cancel('cut');this.cutTarget=value;
  }
  changeAxis(axis){
    this.cutTarget=null;this.queuedCut=undefined;
    this.gesture();this.pendingAxis=axis;this.pendingCut=null;this.exploded=false;
    this.motion.to('cut',this.state,{cut:0},.8);this.motion.to('spread',this.state,{spread:0},1.2);
    document.getElementById('scalpel').value=500;
  }
  spread(value=!this.exploded){
    this.cutTarget=null;this.queuedCut=undefined;
    this.gesture();this.exploded=value;this.pendingCut=null;this.pendingAxis=null;
    this.isolated=false;this.ui.card(this.selected,false);
    this.motion.to('cut',this.state,{cut:0},.8);
    if(!value||this.state.cut<.001)this.motion.to('spread',this.state,{spread:value?1:0},1.2);
    document.getElementById('scalpel').value=0;
    if(!this.selected){if(value)this.rig.spreadFrame();else this.rig.frame();}
  }
  select(part,fromAtlas=false){
    this.gesture();this.selected=part;
    if(!part){this.isolated=false;if(this.exploded)this.rig.spreadFrame();else if(this.state.cut>.001)this.rig.section(this.axis);else this.rig.frame();}
    else if(fromAtlas){
      // Lift the chosen specimen in the exploded view, so even a buried organ is reachable.
      this.isolated=false;this.spread(true);
    }
    this.ui.card(part,this.isolated);
    if(part){this.rig.focus(part.center.clone().add(part.offset),this.size(part));}
  }
  size(p){return Math.max(.2,new T.Vector3(...p.data.maxi).sub(new T.Vector3(...p.data.mini)).length()*.62);}
  isolate(){
    this.cutTarget=null;this.queuedCut=undefined;
    if(!this.selected)return;this.gesture();this.isolated=!this.isolated;
    this.motion.to('cut',this.state,{cut:0},.8);this.pendingCut=null;this.pendingAxis=null;
    this.ui.card(this.selected,this.isolated);
    if(this.isolated)this.rig.isolatedFrame(this.selected);
    else this.rig.focus(this.selected.center.clone().add(this.selected.offset),this.size(this.selected));
  }
  reset(){
    this.cutTarget=null;this.queuedCut=undefined;
    this.pendingAxis=null;this.pendingCut=null;this.exploded=false;this.isolated=false;this.select(null);this.rig.frame();
    this.motion.to('cut',this.state,{cut:0},1.2);this.motion.to('spread',this.state,{spread:0},1.2);
    document.getElementById('scalpel').value=0;
  }
  pick(point,camera){
    if(!point)return null;
    this.ndc.set(point.x/innerWidth*2-1,1-point.y/innerHeight*2);this.ray.setFromCamera(this.ndc,camera);this.hits.length=0;
    this.pickable.length=0;for(const p of this.parts)if(p.group.visible&&p.presence>.8)this.pickable.push(p.body);
    this.ray.intersectObjects(this.pickable,false,this.hits);
    return this.hits.find(h=>this.plane.distanceToPoint(h.point)>=-.0001)?.object.userData.part||null;
  }
  update(dt,now,reduce){
    this.flushCut();
    this.motion.update(now);
    if(this.cutTarget!==null){this.state.cut=T.MathUtils.lerp(this.state.cut,this.cutTarget,1-Math.exp(-dt*9));if(Math.abs(this.state.cut-this.cutTarget)<.000001)this.state.cut=this.cutTarget;}
    if(this.state.cut<.0001){
      if(this.exploded&&this.state.spread<.0001&&!this.motion.jobs.has('spread'))this.motion.to('spread',this.state,{spread:1},1.2);
      if(this.pendingAxis&&this.state.spread<.0001){this.axis=this.pendingAxis;this.pendingAxis=null;this.rig.section(this.axis);this.motion.to('cut',this.state,{cut:.5},.8);}
    }
    if(this.pendingCut!==null&&this.pendingCut!==undefined&&this.state.spread<.0001)this.startCut();
    const damping=1-Math.pow(.935,dt*60);
    this.shadowMoving=false;
    for(const p of this.parts){
      const chosen=p===this.selected;
      const offset=this.offsetTarget.copy(p.exploded).multiplyScalar(this.state.spread);
      if(chosen&&this.exploded)offset.y+=1.25*this.state.spread;
      if(chosen&&this.isolated)offset.copy(p.center).negate().y+=.65;
      if(p.offset.distanceToSquared(offset)>1e-8||Math.abs(p.presence-(this.isolated&&!chosen?0:1))>.0001)this.shadowMoving=true;
      p.offset.lerp(offset,damping);
      p.presence=T.MathUtils.lerp(p.presence,this.isolated&&!chosen?0:1,damping);
      p.focus.value=T.MathUtils.lerp(p.focus.value,!this.selected||chosen?1:this.state.cut>.001?.6:.12,damping);
      let pulse=1;
      if(p.data.id==='coeur'){
        const beat=Math.max(0,Math.sin(now/1000*Math.PI*2*70/60));
        pulse+=Math.pow(beat,4)*(reduce?.003:.026);
      }
      const scale=Math.max(.0001,p.presence);p.group.scale.set(scale,scale,scale*pulse);
      p.group.position.copy(p.offset).add(this.positionTarget.set(p.center.x*(1-scale),p.center.y*(1-scale),p.center.z*(1-scale*pulse)));
      p.group.visible=p.presence>.002;
    }
    const a='xyz'.indexOf(this.axis),[min,max]=this.bounds[a];
    this.coordinate=T.MathUtils.lerp(max,min,this.state.cut);
    this.plane.normal.set(0,0,0).setComponent(a,-1);this.plane.constant=this.state.cut<.00001?50:this.coordinate;
    for(const p of this.parts)p.group.updateMatrixWorld(true);
    this.sections.update(this.state.cut>.00001,a,this.coordinate,this.isolated?this.selected:null,this.interacting,dt,now);
    if(this.selected){
      this.focusPoint.copy(this.selected.center).add(this.selected.offset);
      // Keep the focus on the retained half when a selection is being cut.
      if(this.state.cut>.00001)this.focusPoint.setComponent(a,Math.min(this.focusPoint.getComponent(a),this.coordinate-.015));
      this.rig.lookTarget.copy(this.focusPoint);
    }
    this.ui.rail(this.state.cut,this.axis,this.exploded);
  }
}
