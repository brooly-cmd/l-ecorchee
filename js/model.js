import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {DRACOLoader} from 'three/addons/loaders/DRACOLoader.js';
import {physical} from './materials.js';
import {shells,hairs,hairBuffer,shortHairs} from './fur.js';

export async function loadModel(scene,plane,maps,manager,mobile,progress){
  const draco=new DRACOLoader(manager).setDecoderPath('vendor/draco/').setWorkerLimit(2);
  const loader=new GLTFLoader(manager).setDRACOLoader(draco);
  const data=await (await fetch('assets/parties.json')).json();progress(10);
  const bytes=async name=>{const r=await fetch(`assets/${name}`);if(!r.ok)throw Error(name);return r.arrayBuffer();};
  const forced=new URLSearchParams(location.search).get('palier');
  const useB=!mobile&&(forced===null||Number(forced)<2);
  const [body,skin,a,b]=await Promise.all([
    loader.loadAsync('assets/araignee.glb').then(r=>{progress(45);return r;}),
    loader.loadAsync('assets/peau.glb').then(r=>{progress(60);return r;}),
    bytes(data.poils.fichiers.a).then(buffer=>hairBuffer(buffer,data.poils)),
    useB?bytes(data.poils.fichiers.b).then(buffer=>hairBuffer(buffer,data.poils)):null
  ]);
  const bodyByName=new Map(),skinByName=new Map();
  body.scene.updateMatrixWorld(true);skin.scene.updateMatrixWorld(true);
  body.scene.traverse(o=>{if(o.isMesh)bodyByName.set(o.name,o);});
  skin.scene.traverse(o=>{if(o.isMesh)skinByName.set(o.name,o);});
  const parts=data.parties.map((d,index)=>{
    const source=bodyByName.get(d.id);if(!source)throw Error(`Partie manquante : ${d.id}`);
    // Bake the glTF transform once; all later gestures share the same world coordinates.
    const geometry=source.geometry.clone().applyMatrix4(source.matrixWorld);
    geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const group=new T.Group(),focus={value:1},body=new T.Mesh(geometry,physical(d,plane,maps,focus));
    group.name=d.id;body.name=d.id;body.castShadow=body.receiveShadow=true;body.renderOrder=1000;
    group.add(body);scene.add(group);
    if(d.mat==='oeil'){
      // A real absorbing core under each cornea, with a small physical gap. Alpha blending
      // keeps these eight tiny lenses inexpensive (no full-scene transmission render pass).
      const core=eyeCore(geometry),material=physical(d,plane,maps,focus);
      material.color.set('#241811');material.roughness=.3;material.clearcoat=.05;
      const inner=new T.Mesh(core,material);inner.renderOrder=1000;group.add(inner);
      body.material.transparent=true;body.material.alphaToCoverage=false;body.material.depthWrite=false;body.material.opacity=.55;body.material.envMapIntensity=1.45;body.renderOrder=1001;
    }
    const part={data:d,index,group,body,focus,center:new T.Vector3(...d.centre),offset:new T.Vector3(),shell:null,hairs:[],presence:1};
    body.userData.part=part;
    const skinMesh=skinByName.get(`peau_${d.id}`);
    if(skinMesh&&d.fourrure_longueur){
      const skinGeometry=skinMesh.geometry.clone().applyMatrix4(skinMesh.matrixWorld);
      const comb=new T.Vector3(),range=data.poils.table.a[d.id],tangent=a.attributes.fibreTangent;
      // The undercoat follows this part's supplied hair, rather than a global comb direction.
      if(range)for(let h=0;h<range[1];h+=Math.max(1,Math.floor(range[1]/400))){const j=(range[0]+h)*a.verticesPerHair;comb.x+=tangent.getX(j);comb.y+=tangent.getY(j);comb.z+=tangent.getZ(j);}
      if(comb.lengthSq()<.0001)comb.set(.13,-1,-.28);comb.normalize();
      skinGeometry.computeBoundingSphere();part.shell=shells(skinGeometry,d,plane,focus,comb);group.add(part.shell);
      // The measured A-only ladder never displays the close-up duvet (levels >= 2).
      // Avoid building thousands of invisible fibres and retaining their buffers.
      if(useB||(forced!==null&&Number(forced)<2)){
        const duvet=shortHairs(skinGeometry,d,plane,focus,comb,mobile);group.add(duvet);part.hairs.push(duvet);
      }
    }
    for(const [key,shared] of [['a',a],['b',b]]){
      const range=data.poils.table[key]?.[d.id];
      if(shared&&range?.[1]){const mesh=hairs(shared,range,d,plane,focus,data.poils.echelle);mesh.userData.batch=key;group.add(mesh);part.hairs.push(mesh);}
    }
    part.exploded=explosion(d,index);
    group.traverse(o=>{if(o!==group){o.updateMatrix();o.matrixAutoUpdate=false;}});
    return part;
  });
  draco.dispose();progress(82);
  return {parts,data,loadedB:!!b};
}

function eyeCore(geometry){
  const g=geometry.clone(),a=g.getAttribute('position'),index=g.index,n=a.count;
  const parents=Int32Array.from({length:n},(_,i)=>i),weld=new Map();
  const root=i=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
  const join=(a,b)=>{parents[root(a)]=root(b);};
  for(let i=0;i<n;i++){
    const key=[a.getX(i),a.getY(i),a.getZ(i)].map(v=>Math.round(v*1e5)).join(',');
    if(weld.has(key))join(i,weld.get(key));else weld.set(key,i);
  }
  const count=index?index.count:n;
  for(let i=0;i<count;i+=3){const x=index?index.getX(i):i;join(x,index?index.getX(i+1):i+1);join(x,index?index.getX(i+2):i+2);}
  const boxes=new Map(),v=new T.Vector3();
  for(let i=0;i<n;i++){const id=root(i);if(!boxes.has(id))boxes.set(id,new T.Box3());boxes.get(id).expandByPoint(v.fromBufferAttribute(a,i));}
  const centers=new Map([...boxes].map(([id,box])=>[id,box.getCenter(new T.Vector3())]));
  for(let i=0;i<n;i++){const c=centers.get(root(i));v.fromBufferAttribute(a,i).sub(c).multiplyScalar(.86).add(c);a.setXYZ(i,v.x,v.y,v.z);}
  a.needsUpdate=true;g.computeBoundingSphere();return g;
}

function explosion(d,index){
  const [x,y,z]=d.centre,side=Math.sign(x)||1;
  if(d.id==='carapace')return new T.Vector3(0,1.35,.12);
  if(d.id==='sternum')return new T.Vector3(0,-.3,1.1);
  if(d.id==='abdomen')return new T.Vector3(0,1.15,-1.15);
  if(d.groupe.startsWith('patte')){
    const rank=['coxa','trochanter','femur','patelle','tibia','metatarse','tarse'].indexOf(d.id.split('_')[0]);
    return new T.Vector3(x,0,z*.6).normalize().multiplyScalar(.42+rank*.12).add(new T.Vector3(0,.15,0));
  }
  if(d.mat==='cuticule'||d.mat==='griffe'||d.mat==='oeil')return new T.Vector3(side*.35,.5,z>0?.7:-.6);
  if(d.groupe==='muscles'&&Math.abs(x)>.2)return new T.Vector3(side*.55,.65,z*.15);
  const angle=index*2.399963;
  return new T.Vector3(Math.cos(angle)*.6,.35+(index%4)*.2,Math.sin(angle)*.55);
}
