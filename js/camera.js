import * as T from 'three';
export class CameraRig {
  constructor(camera,canvas,onTap,onGesture){
    this.camera=camera;this.canvas=canvas;this.onTap=onTap;this.onGesture=onGesture;this.pointers=new Map();this.theta=.32;this.phi=1.27;this.radius=this.homeRadius();
    this.target={theta:this.theta,phi:this.phi,radius:this.radius};this.look=new T.Vector3(0,.5,.25);this.lookTarget=this.look.clone();this.mouse=new T.Vector2();this.parallax=new T.Vector2();this.lastTap=0;this.focused=false;this.moved=false;
    canvas.addEventListener('pointerdown',e=>this.down(e));canvas.addEventListener('pointermove',e=>this.move(e));canvas.addEventListener('pointerup',e=>this.up(e));canvas.addEventListener('pointercancel',e=>this.up(e,true));
    canvas.addEventListener('wheel',e=>{e.preventDefault();this.target.radius=T.MathUtils.clamp(this.target.radius*Math.exp(e.deltaY*.001),.38,34);onGesture();},{passive:false});
    canvas.addEventListener('keydown',e=>{const k=e.key;if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','0','Escape'].includes(k))return;e.preventDefault();onGesture();if(k==='ArrowLeft')this.target.theta-=.15;if(k==='ArrowRight')this.target.theta+=.15;if(k==='ArrowUp')this.target.phi-=.1;if(k==='ArrowDown')this.target.phi+=.1;if(k==='+'||k==='=')this.target.radius*=.9;if(k==='-')this.target.radius*=1.1;if(k==='0')this.frame();if(k==='Escape')onTap(null);this.clamp();});
    canvas.addEventListener('dblclick',e=>{e.preventDefault();this.frame();});
  }
  clamp(){this.target.phi=T.MathUtils.clamp(this.target.phi,.16,1.38);this.target.radius=T.MathUtils.clamp(this.target.radius,.38,34);}
  down(e){this.onGesture();this.canvas.setPointerCapture(e.pointerId);this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,ox:e.clientX,oy:e.clientY});this.moved=false;if(this.pointers.size>1){this.pinch=this.distance();this.moved=true;}this.canvas.classList.add('dragging');}
  distance(){const a=[...this.pointers.values()];return a.length===2?Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y):0;}
  move(e){this.mouse.set(e.clientX/innerWidth-.5,e.clientY/innerHeight-.5);const p=this.pointers.get(e.pointerId);if(!p)return;const dx=e.clientX-p.x,dy=e.clientY-p.y;p.x=e.clientX;p.y=e.clientY;if(Math.hypot(p.x-p.ox,p.y-p.oy)>6)this.moved=true;if(this.pointers.size===2){const distance=this.distance();if(this.pinch>0&&distance>0)this.pendingZoom=(this.pendingZoom||1)*this.pinch/distance;this.pinch=distance;}else if(this.moved){this.pendingX=(this.pendingX||0)+dx;this.pendingY=(this.pendingY||0)+dy;}}
  up(e,cancel=false){const p=this.pointers.get(e.pointerId);if(!p)return;const tap=!cancel&&!this.moved&&this.pointers.size===1&&Math.hypot(p.x-p.ox,p.y-p.oy)<=6;this.pointers.delete(e.pointerId);if(this.pointers.size)this.moved=true;else this.canvas.classList.remove('dragging');if(tap){const now=performance.now();if(now-this.lastTap<330){this.frame();this.lastTap=0;}else{this.lastTap=now;this.onTap({x:e.clientX,y:e.clientY});}}}
  specimen(parts){
    this.homePoints=[];this.spreadPoints=[];
    for(const p of parts){
      const positions=p.body.geometry.getAttribute('position'),normals=p.body.geometry.getAttribute('normal');
      const pad=(p.data.fourrure_longueur||0)+.045;
      // Sample the real silhouette, rather than empty corners of large curved-part boxes.
      for(let i=0;i<positions.count;i+=Math.max(1,Math.floor(positions.count/96))){
        const v=new T.Vector3().fromBufferAttribute(positions,i).addScaledVector(new T.Vector3().fromBufferAttribute(normals,i),pad);
        this.homePoints.push(v);this.spreadPoints.push(v.clone().add(p.exploded));
      }
    }
  }
  fit(points){
    if(!points)return;
    const {theta,phi}=this.target,tan=Math.tan(T.MathUtils.degToRad(this.camera.fov/2));
    const forward=new T.Vector3(Math.sin(phi)*Math.sin(theta),Math.cos(phi),Math.sin(phi)*Math.cos(theta));
    const right=new T.Vector3(Math.cos(theta),0,-Math.sin(theta)),up=new T.Vector3().crossVectors(forward,right);
    const projected=points.map(p=>{const v=p.clone().sub(this.lookTarget);return {x:v.dot(right),y:v.dot(up),z:v.dot(forward)};});
    const top=innerWidth<700?125:145,bottom=this.pose==='isolated'&&innerWidth<700?430:innerHeight-(innerWidth<700?225:this.pose==='spread'?190:220),side=innerWidth<700?22:this.pose==='isolated'?220:70;
    const bounds=radius=>{
      const x=projected.map(p=>p.x/(radius-p.z)/tan*innerHeight/2),y=projected.map(p=>-p.y/(radius-p.z)/tan*innerHeight/2);
      return {left:Math.min(...x),right:Math.max(...x),top:Math.min(...y),bottom:Math.max(...y)};
    };
    let low=Math.max(...projected.map(p=>p.z))+.06,high=50;
    for(let i=0;i<22;i++){
      const middle=(low+high)/2,b=bounds(middle);
      if(b.right-b.left>innerWidth-2*side||b.bottom-b.top>bottom-top)low=middle;else high=middle;
    }
    const b=bounds(high);this.target.radius=high;
    this.framing={x:(b.left+b.right)/2/innerWidth,y:(b.top+b.bottom)/2/innerHeight+.5-(top+bottom)/2/innerHeight};
  }
  frame(){this.focused=false;this.pose='home';this.target.theta=.32;this.target.phi=1.27;this.lookTarget.set(0,.65,.1);this.target.radius=this.homeRadius();this.fit(this.homePoints);}
  homeRadius(){return innerWidth<700?22:11.2;}
  section(axis){
    this.focused=false;this.pose='cut';this.framing={x:0,y:innerWidth<700?.09:.035};
    // The removed half is always on +axis, so look into the retained section from there.
    this.target.theta=axis==='x'?Math.PI/2:axis==='y'?.16:0;
    this.target.phi=axis==='y'?.18:1.31;
    this.target.radius=innerWidth<700?(axis==='x'?15.8:axis==='y'?22:16):(axis==='x'?8.2:axis==='y'?10.6:7.6);
    this.lookTarget.set(0,.7,-.25);
    if(axis==='y')this.fit(this.homePoints);
  }
  spreadFrame(){this.frame();this.pose='spread';this.target.phi=.98;this.target.theta=.28;this.lookTarget.set(0,.95,0);this.target.radius=innerWidth<700?27:15;this.fit(this.spreadPoints);}
  focus(point,size=1){this.focused=true;this.lookTarget.copy(point);this.target.radius=T.MathUtils.clamp(size*(innerWidth<700?4.8:2.7),.48,14);}
  isolatedFrame(part){
    this.focused=true;this.pose='isolated';
    // Fit the actual silhouette in the clear part of the screen, including tiny specimens.
    const g=part.body.geometry,a=g.getAttribute('position'),points=[];
    const center=new T.Vector3(0,.65,0),offset=center.clone().sub(part.center);
    this.lookTarget.copy(center);
    for(let i=0;i<a.count;i+=Math.max(1,Math.floor(a.count/280))){
      const p=new T.Vector3().fromBufferAttribute(a,i).add(offset);points.push(p);
    }
    this.fit(points);
    this.target.radius*=innerWidth<700?1.32:1.2;
    this.target.radius=Math.max(.48,this.target.radius);
  }
  update(dt,time,reduce,cardOpen){
    this.target.theta-=(this.pendingX||0)*.006;this.target.phi-=(this.pendingY||0)*.005;this.target.radius*=this.pendingZoom||1;
    this.pendingX=this.pendingY=0;this.pendingZoom=1;this.clamp();
    const damping=1-Math.pow(1-.065,dt*60);this.theta=T.MathUtils.lerp(this.theta,this.target.theta,damping);this.phi=T.MathUtils.lerp(this.phi,this.target.phi,damping);this.radius=T.MathUtils.lerp(this.radius,this.target.radius,damping);this.look.lerp(this.lookTarget,damping);this.parallax.lerp(this.mouse,damping);
    const breathing=reduce||this.pointers.size?0:Math.sin(time*.27)*.008;const theta=this.theta+(innerWidth>700?this.parallax.x*.045:0);const phi=this.phi+breathing+(innerWidth>700?this.parallax.y*.025:0);
    this.camera.position.set(this.radius*Math.sin(phi)*Math.sin(theta),this.radius*Math.cos(phi),this.radius*Math.sin(phi)*Math.cos(theta)).add(this.look);this.camera.lookAt(this.look);
    // Shift the subject above the bottom sheet without changing its world position.
    const fitted=cardOpen&&this.pose==='isolated';
    const desired=fitted?(this.framing?.y??0)+(innerWidth<700?.025:0):cardOpen?(innerWidth<700?.20:.035):(this.framing?.y??.09);
    this.offset=T.MathUtils.lerp(this.offset||0,desired,damping);
    this.offsetX=T.MathUtils.lerp(this.offsetX||0,cardOpen?(fitted?(this.framing?.x||0):0)+(innerWidth<700?0:.14):(this.framing?.x||0),damping);
    this.camera.setViewOffset(innerWidth,innerHeight,innerWidth*this.offsetX,innerHeight*this.offset,innerWidth,innerHeight);
    this.camera.updateMatrixWorld();
  }
}
