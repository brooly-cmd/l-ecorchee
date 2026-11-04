import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {shells,hairs} from './fur.js';

// Originals remain available for picking, isolation and the exploded anatomy.
// No geometry or material is built while interacting.
export class Batches {
  constructor(scene,parts,plane){
    this.parts=parts;this.root=new T.Group();this.root.name='specimen-fusionne';scene.add(this.root);
    this.bodies=[];this.hairs=[];this.shell=null;
    const skins=parts.filter(p=>p.data.mat==='cuticule');
    for(const fur of [false,true]){
      const items=skins.filter(p=>!!p.shell===fur);if(!items.length)continue;
      const mesh=new T.Mesh(mergeGeometries(items.map(p=>p.body.geometry),false),items[0].body.material.clone());
      // Material.clone() clones Plane instances; the scalpel must keep its live plane.
      mesh.material.clippingPlanes=items[0].body.material.clippingPlanes;
      mesh.material.onBeforeCompile=items[0].body.material.onBeforeCompile;
      mesh.material.customProgramCacheKey=items[0].body.material.customProgramCacheKey;
      // Batch focus is always 1; any selected part switches to the originals.
      mesh.castShadow=mesh.receiveShadow=true;mesh.renderOrder=1000;this.root.add(mesh);this.bodies.push({mesh,items});
    }
    const coated=parts.filter(p=>p.shell),geometries=[];
    for(const p of coated){
      const source=p.shell.geometry,g=new T.BufferGeometry();g.setIndex(source.index);
      for(const key of ['position','normal','color','uv'])if(source.getAttribute(key))g.setAttribute(key,source.getAttribute(key));
      const n=g.getAttribute('position').count;
      const params=p.shell.userData.parameters;
      for(const [key,value] of Object.entries({coatComb:params.comb.toArray(),coatCenter:p.data.centre,coatShape:[p.data.fourrure_longueur*.38,p.data.id==='carapace'?1:0]})){
        const a=new Float32Array(n*value.length);for(let i=0;i<n;i++)a.set(value,i*value.length);g.setAttribute(key,new T.BufferAttribute(a,value.length));
      }
      geometries.push(g);
    }
    if(geometries.length){
      const merged=mergeGeometries(geometries,false),first=coated[0];
      merged.computeBoundingBox();merged.computeBoundingSphere();
      this.shell=shells(merged,first.data,plane,{value:1},first.shell.userData.parameters.comb);
      const m=this.shell.material,compile=m.onBeforeCompile;
      m.onBeforeCompile=shader=>{
        compile(shader);
        shader.vertexShader='attribute vec3 coatComb,coatCenter;attribute vec2 coatShape;\n'+shader.vertexShader;
        shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
          float uFurLength=coatShape.x,uFurRadial=coatShape.y;
          vec3 uFurComb=coatComb,uFurCenter=coatCenter;
          float uNearLength=mix(.018,.12,smoothstep(1.0,8.0,distance(cameraPosition,(modelMatrix*vec4(coatCenter,1.0)).xyz)));`);
      };
      m.customProgramCacheKey=()=> 'ecorchee-shell-batch-v1';this.shell.onBeforeRender=()=>{};this.root.add(this.shell);
      for(const g of geometries)g.dispose();
    }
    for(const batch of ['a','b']){
      const items=parts.flatMap(p=>p.hairs.filter(h=>h.userData.batch===batch));if(!items.length)continue;
      const first=items[0],ranges=items.map(h=>h.userData.fullRange),stride=first.userData.indicesPerHair;
      const total=ranges.reduce((sum,r)=>sum+r[1],0),max=Math.max(...ranges.map(r=>r[1])),indices=new Uint32Array(total*stride),source=first.geometry.index.array;
      // Round-robin strands keep EVERY part represented even at 10% density.
      let offset=0;for(let round=0;round<max;round++)for(const [start,count] of ranges)if(round<count){const i=(start+round)*stride;indices.set(source.subarray(i,i+stride),offset);offset+=stride;}
      const mesh=hairs({attributes:first.geometry.attributes,index:new T.BufferAttribute(indices,1),indicesPerHair:stride},[0,total],{id:'fusion',mini:[-5,-2,-5],maxi:[5,5,5]},plane,{value:1});
      mesh.userData.batch=batch;this.hairs.push(mesh);this.root.add(mesh);
    }
    this.root.visible=false;
  }
  update(anatomy){
    const active=!anatomy.selected&&!anatomy.isolated&&anatomy.state.spread<.00001&&this.parts.every(p=>p.presence>.99999&&p.focus.value>.99999&&p.offset.lengthSq()<1e-8);
    this.root.visible=active;
    for(const {items} of this.bodies)for(const p of items)p.body.visible=!active;
    for(const p of this.parts){
      if(p.shell)p.shell.visible=!active&&p.shell.userData.qualityVisible;
      for(const h of p.hairs)h.visible=h.userData.qualityVisible&&(!active||h.userData.batch==='duvet');
    }
  }
}
