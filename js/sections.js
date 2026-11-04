import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {sectionMaterial} from './materials.js';
// Trace the REAL outer skin/plane intersection into a small, cached pigment map.
// The stencil still closes the exact wall; the map only grades black outside → blue inside.
// This avoids an ellipsoid approximation, a second render pass, or a per-pixel triangle search.
class CuticleEdges {
  constructor(parts){
    this.parts=parts;this.axis={value:0};this.coordinate=Infinity;this.lastUpdate=0;
    this.canvas=document.createElement('canvas');this.canvas.width=this.canvas.height=innerWidth<700?1024:2048;
    this.ctx=this.canvas.getContext('2d',{alpha:false});
    this.texture=new T.CanvasTexture(this.canvas);this.texture.colorSpace=T.NoColorSpace;
    this.texture.generateMipmaps=false;this.texture.minFilter=T.LinearFilter;this.texture.magFilter=T.LinearFilter;
    this.sources=parts.map(p=>{
      const g=p.shell?.geometry||p.body.geometry,a=g.getAttribute('position'),index=g.index;
      const count=index?index.count:a.count,triangles=new Float32Array(count*3);
      for(let i=0;i<count;i++){const j=index?index.getX(i):i;triangles[i*3]=a.getX(j);triangles[i*3+1]=a.getY(j);triangles[i*3+2]=a.getZ(j);}
      return {p,triangles};
    });
  }
  update(axis,coordinate,isolated){
    const now=performance.now(),same=this.axis.value===axis&&this.isolated===isolated;
    if(same&&(Math.abs(coordinate-this.coordinate)<.00025||now-this.lastUpdate<40))return;
    this.axis.value=axis;this.coordinate=coordinate;this.isolated=isolated;this.lastUpdate=now;
    const ctx=this.ctx,size=this.canvas.width,scale=size/10,u=axis===0?2:0,v=axis===1?2:1;
    ctx.fillStyle='#000';ctx.fillRect(0,0,size,size);ctx.beginPath();
    for(const {p,triangles:t} of this.sources){
      if(isolated&&p!==isolated||!p.group.visible)continue;
      const offset=p.group.position,s=p.group.scale.x,c=(coordinate-offset.getComponent(axis))/s;
      if(c<p.data.mini[axis]||c>p.data.maxi[axis])continue;
      const ou=offset.getComponent(u),ov=offset.getComponent(v);let firstU=0,firstV=0,hits=0;
      for(let i=0;i<t.length;i+=9){
        const a=t[i+axis]-c,b=t[i+3+axis]-c,d=t[i+6+axis]-c;
        if((a>0&&b>0&&d>0)||(a<0&&b<0&&d<0))continue;
        hits=0;
        for(let e=0;e<3;e++){
          const j=i+e*3,k=i+(e+1)%3*3,da=t[j+axis]-c,db=t[k+axis]-c;
          if((da<0)===(db<0)||Math.abs(da-db)<1e-9)continue;
          const f=da/(da-db),x=((t[j+u]+(t[k+u]-t[j+u])*f)*s+ou)*scale+size*.5,y=size*.5-((t[j+v]+(t[k+v]-t[j+v])*f)*s+ov)*scale;
          if(hits++===0){firstU=x;firstV=y;}else{ctx.moveTo(firstU,firstV);ctx.lineTo(x,y);break;}
        }
      }
    }
    ctx.lineJoin=ctx.lineCap='round';
    for(const [width,color] of [[.032,'#242424'],[.021,'#666666'],[.011,'#bbbbbb'],[.004,'#ffffff']]){ctx.lineWidth=width*scale;ctx.strokeStyle=color;ctx.stroke();}
    this.texture.needsUpdate=true;
  }
}
// Increment back faces, decrement front faces, cap where stencil != 0, clear after EACH cap.
// Adapted from the MIT Three.js r187 example webgl_clipping_stencil.
export class Sections {
  constructor(scene,parts,plane){
    this.plane=plane;this.entries=[];this.single=new Map();this.box=new T.Box3();this.root=new T.Group();this.root.name='sections';scene.add(this.root);
    const cuticle=parts.filter(p=>p.data.mat==='cuticule');
    this.edge=new CuticleEdges(cuticle);
    const proxies=cuticle.map(p=>{const g=new T.BufferGeometry();g.setAttribute('position',p.body.geometry.getAttribute('position'));if(p.body.geometry.index)g.setIndex(p.body.geometry.index);return g.index?g.toNonIndexed():g;});
    const merged=mergeGeometries(proxies,false);
    this.add(merged,new T.Color('#1a55c9'),{value:1},null,1,true);
    for(const g of proxies)g.dispose();
    let order=5;
    for(const p of parts.filter(p=>p.data.mat!=='cuticule')){
      const color=p.body.geometry.getAttribute('color'),average=new T.Color(0,0,0);let n=0;
      if(color)for(let i=0;i<color.count;i+=Math.max(1,Math.floor(color.count/80))){average.r+=color.getX(i);average.g+=color.getY(i);average.b+=color.getZ(i);n++;}
      if(n)average.multiplyScalar(1/n);else average.set('#bd8171');
      average.multiplyScalar(1.06);
      this.add(p.body.geometry,average,p.focus,p,order,false);order+=4;
    }
  }
  add(geometry,color,focus,part,order,blue){
    const group=new T.Group();this.root.add(group);
    const base={depthWrite:false,depthTest:false,colorWrite:false,stencilWrite:true,stencilFunc:T.AlwaysStencilFunc,clippingPlanes:[this.plane]};
    const back=new T.MeshPhysicalMaterial({...base,side:T.BackSide,stencilFail:T.IncrementWrapStencilOp,stencilZFail:T.IncrementWrapStencilOp,stencilZPass:T.IncrementWrapStencilOp});
    const front=new T.MeshPhysicalMaterial({...base,side:T.FrontSide,stencilFail:T.DecrementWrapStencilOp,stencilZFail:T.DecrementWrapStencilOp,stencilZPass:T.DecrementWrapStencilOp});
    const b=new T.Mesh(geometry,back),f=new T.Mesh(geometry,front);b.renderOrder=order;f.renderOrder=order+1;group.add(b,f);
    const cap=new T.Mesh(new T.PlaneGeometry(24,24),sectionMaterial(color,focus,blue,this.edge));cap.renderOrder=order+2;cap.frustumCulled=false;cap.onAfterRender=renderer=>renderer.clearStencil();group.add(cap);
    this.entries.push({group,b,f,cap,part});
  }
  update(active,axis,coordinate,isolated){
    this.root.visible=active;
    if(!active)return;
    this.edge.update(axis,coordinate,isolated);
    if(isolated?.data.mat==='cuticule'&&!this.single.has(isolated)){
      this.add(isolated.body.geometry,new T.Color('#1a55c9'),isolated.focus,isolated,1,true);
      this.single.set(isolated,this.entries.at(-1));
    }
    for(const e of this.entries){
      const p=e.part;
      e.group.visible=p?p.group.visible&&(!isolated||p===isolated):!isolated;
      if(p&&e.group.visible){
        this.box.copy(p.body.geometry.boundingBox).applyMatrix4(p.group.matrixWorld);
        e.group.visible=this.box.min.getComponent(axis)<=coordinate&&this.box.max.getComponent(axis)>=coordinate;
        if(p.data.mat==='cuticule')e.group.visible=e.group.visible&&isolated===p;
      }
      if(!e.group.visible)continue;
      if(p){e.b.matrixAutoUpdate=e.f.matrixAutoUpdate=false;e.b.matrix.copy(p.group.matrixWorld);e.f.matrix.copy(p.group.matrixWorld);}
      this.plane.coplanarPoint(e.cap.position);e.cap.lookAt(e.cap.position.clone().sub(this.plane.normal));
    }
  }
}
