import * as T from 'three';
import {HDRLoader} from 'three/addons/loaders/HDRLoader.js';

export async function studio(canvas,manager){
  // Opaque porcelain background: coverage AA must not leak canvas alpha into the page.
  const renderer=new T.WebGLRenderer({canvas,antialias:true,stencil:true,alpha:false,powerPreference:'high-performance'});
  renderer.localClippingEnabled=true;
  renderer.outputColorSpace=T.SRGBColorSpace;
  renderer.toneMapping=T.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1;
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=T.PCFShadowMap;
  const scene=new T.Scene();
  scene.background=new T.Color('#dfe5e6');
  scene.fog=new T.Fog('#dfe5e6',24,65);
  const camera=new T.PerspectiveCamera(36,innerWidth/innerHeight,.04,100);
  const light=new T.DirectionalLight('#fff7ee',2);
  light.position.set(-3,9,5);light.castShadow=true;
  Object.assign(light.shadow.camera,{left:-8,right:8,top:8,bottom:-8,near:.5,far:26});
  light.shadow.mapSize.set(2048,2048);light.shadow.bias=-.0001;light.shadow.normalBias=.008;light.shadow.radius=4;
  scene.add(light);
  const ground=new T.Mesh(new T.PlaneGeometry(200,200),new T.MeshPhysicalMaterial({color:'#dfe5e6',roughness:1,clearcoat:0,specularIntensity:0}));
  ground.material.transparent=true;
  ground.rotation.x=-Math.PI/2;ground.position.y=-.09;ground.receiveShadow=true;ground.renderOrder=-10;scene.add(ground);
  const hdr=await new HDRLoader(manager).loadAsync('assets/studio-small-09-1k.hdr');
  const pmrem=new T.PMREMGenerator(renderer);const environment=pmrem.fromEquirectangular(hdr);
  scene.environment=environment.texture;scene.environmentIntensity=.65;
  hdr.dispose();pmrem.dispose();
  const resize=()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);};
  addEventListener('resize',resize);resize();
  return {renderer,scene,camera,light,ground,environment};
}

export async function reliefs(manager){
  const loader=new T.TextureLoader(manager);
  const [cuticule,organe]=await Promise.all(['cuticule','organe'].map(n=>loader.loadAsync(`assets/relief-${n}.png`)));
  for(const texture of [cuticule,organe]){texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.colorSpace=T.NoColorSpace;texture.repeat.set(7,7);}
  const muscle=organe.clone();muscle.repeat.set(3,18);
  return {cuticule,organe,muscle,vessels:vesselTexture(),cavity:{plane:{value:new T.Vector4(-1,0,0,50)},amount:{value:0}}};
}

// Actual tapered trees: unlike a noise isoline these cannot close into contour loops.
function vesselTexture(){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1024;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#000';ctx.fillRect(0,0,1024,1024);
  let seed=7823;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  function branch(x,y,angle,length,width,depth){
    const bend=(random()-.5)*.6,endX=x+Math.cos(angle+bend)*length,endY=y+Math.sin(angle+bend)*length;
    ctx.strokeStyle=`rgb(${Math.round(100+depth*22)},${Math.round(100+depth*22)},${Math.round(100+depth*22)})`;ctx.lineCap='round';
    // Taper each segment as well as its descendants.
    for(let i=0;i<8;i++){
      const a=i/8,b=(i+1)/8;ctx.lineWidth=width*(1-a*.55);ctx.beginPath();
      ctx.moveTo(x+(endX-x)*a,y+(endY-y)*a);ctx.lineTo(x+(endX-x)*b,y+(endY-y)*b);ctx.stroke();
    }
    if(depth<=0)return;
    branch(endX,endY,angle+bend+(random()-.5)*.8,length*(.63+random()*.12),width*.6,depth-1);
    if(depth>1||random()>.55)branch(endX,endY,angle+bend+(random()>.5?1:-1)*(.45+random()*.6),length*(.42+random()*.23),width*.47,depth-1);
  }
  for(let i=0;i<9;i++)branch(160+random()*704,160+random()*704,random()*Math.PI*2,55+random()*55,1.8+random()*1.1,5);
  const texture=new T.CanvasTexture(canvas);texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.colorSpace=T.NoColorSpace;
  return texture;
}
