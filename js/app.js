import * as T from 'three';
import {studio,reliefs} from './studio.js';
import {loadModel} from './model.js';
import {CameraRig} from './camera.js';
import {Sections} from './sections.js';
import {Quality} from './quality.js';
import {Anatomy} from './anatomy.js';
import {Interface} from './interface.js';
import {Batches} from './batches.js';
import {GestureRenderer} from './gesture-renderer.js';

const $=id=>document.getElementById(id),canvas=$('scene');
const reduce=matchMedia('(prefers-reduced-motion: reduce)');
const mobile=matchMedia('(pointer: coarse)').matches||innerWidth<700;
let renderer,progressValue=0;
function progress(value){progressValue=Math.max(progressValue,value);$('loading-percent').textContent=`${Math.round(progressValue)} %`;$('loading-bar').style.width=`${progressValue}%`;}
function fallback(error){
  renderer?.setAnimationLoop(null);$('loading').classList.add('done');$('fallback').hidden=false;
  $('fallback-message').textContent='La vue 3D ne peut pas s’ouvrir. Vérifie que la page passe par le lanceur local, puis réessaie.';
  $('instrument').inert=true;$('atlas-toggle').disabled=true;
  if(error)console.error(error);
}
$('retry').addEventListener('click',()=>location.reload());
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();fallback();});

try{
  // Test first: no asset downloads or broken controls when WebGL2 is unavailable.
  const context=canvas.getContext('webgl2',{antialias:true,stencil:true,alpha:false,powerPreference:'high-performance'});
  if(!context){fallback();}else{
    const manager=new T.LoadingManager();progress(3);
    const world=await studio(canvas,manager);renderer=world.renderer;
    const debug=context.getExtension('WEBGL_debug_renderer_info');
    const gpu=debug?context.getParameter(debug.UNMASKED_RENDERER_WEBGL):context.getParameter(context.RENDERER);
    const integrated=/intel|iris|uhd|swiftshader|llvmpipe|apple gpu|mali|adreno/i.test(gpu);
    const maps=await reliefs(manager);progress(8);
    const plane=new T.Plane(new T.Vector3(-1,0,0),50);
    const {parts,data,loadedB}=await loadModel(world.scene,plane,maps,manager,mobile||integrated,progress);
    const batches=new Batches(world.scene,parts,plane);
    let anatomy;
    const rig=new CameraRig(world.camera,canvas,p=>anatomy.select(anatomy.pick(p,world.camera)),()=>anatomy?.gesture());rig.specimen(parts);rig.frame();
    const sections=new Sections(world.scene,parts,plane);
    anatomy=new Anatomy(parts,plane,rig,sections);
    const ui=new Interface(parts,{select:(p,atlas)=>anatomy.select(p,atlas),isolate:()=>anatomy.isolate(),explode:()=>anatomy.spread(),reset:()=>anatomy.reset(),cut:v=>anatomy.cut(v),axis:a=>anatomy.changeAxis(a),gesture:()=>anatomy.gesture()});
    anatomy.ui=ui;
    const quality=new Quality(renderer,world.light,parts,mobile,integrated,batches);
    const drawing=new GestureRenderer(renderer,world.scene,world.camera,mobile||integrated);
    quality.onResolutionChange=()=>drawing.resize();
    rig.update(1/60,0,reduce.matches,false);anatomy.update(1/60,performance.now(),reduce.matches);
    progress(90);await renderer.compileAsync(world.scene,world.camera);
    // Compile the section shaders behind the loading veil as well.
    sections.update(true,0,0);await renderer.compileAsync(world.scene,world.camera);sections.update(false,0,0);
    await drawing.prepare();
    sections.preload(renderer,world.scene,world.camera);
    // Upload the cap buffers and all three plane orientations before the veil lifts.
    for(let axis=0;axis<3;axis++){
      plane.normal.set(0,0,0).setComponent(axis,-1);plane.constant=0;
      sections.update(true,axis,0,null,true);renderer.render(world.scene,world.camera);
    }
    anatomy.update(1/60,performance.now(),reduce.matches);batches.update(anatomy);
    renderer.shadowMap.needsUpdate=true;renderer.render(world.scene,world.camera);progress(100);$('loading').classList.add('done');
    let previous=performance.now(),shadowCut=anatomy.coordinate,shadowSpread=0,shadowSelected=null,shadowIsolated=false,shadowUpdates=1;
    addEventListener('resize',()=>{if(!anatomy.selected){if(anatomy.exploded)rig.spreadFrame();else if(anatomy.state.cut>.001)rig.section(anatomy.axis);else rig.frame();}});
    renderer.setAnimationLoop(now=>{
      const elapsed=now-previous,dt=Math.max(.001,elapsed/1000);previous=now;
      if(document.hidden)return;
      quality.beginFrame(now,dt);anatomy.interacting=quality.interacting;
      anatomy.update(dt,now,reduce.matches);rig.update(dt,now/1000,reduce.matches,!!anatomy.selected);ui.lenis?.raf(now);
      batches.update(anatomy);
      maps.cavity.plane.value.set(plane.normal.x,plane.normal.y,plane.normal.z,plane.constant);
      const damp=1-Math.pow(.935,dt*60);
      maps.cavity.amount.value=T.MathUtils.lerp(maps.cavity.amount.value,anatomy.state.cut>.001&&!anatomy.isolated?1:0,damp);
      world.ground.material.opacity=T.MathUtils.lerp(world.ground.material.opacity,anatomy.isolated?0:1,damp);
      if(!quality.interacting&&(anatomy.shadowMoving||Math.abs(shadowCut-anatomy.coordinate)>.002||Math.abs(shadowSpread-anatomy.state.spread)>.002||shadowSelected!==anatomy.selected||shadowIsolated!==anatomy.isolated)){
        renderer.shadowMap.needsUpdate=true;shadowUpdates++;
        shadowCut=anatomy.coordinate;shadowSpread=anatomy.state.spread;shadowSelected=anatomy.selected;shadowIsolated=anatomy.isolated;
      }
      drawing.draw(quality.detail);quality.update(elapsed,now,dt);
    });
    // Read-only diagnostics used by the repeatable local browser checks.
    window.ecorchee={snapshot:()=>({ready:true,parts:parts.length,axis:anatomy.axis,cut:anatomy.state.cut,coordinate:anatomy.coordinate,spread:anatomy.state.spread,selected:anatomy.selected?.data.id||null,isolated:anatomy.isolated,groundOpacity:world.ground.material.opacity,palier:quality.level,fps:quality.fps,loadedB,gpu,integrated,gesture:quality.interacting,detail:quality.detail,batched:batches.root.visible,shadowUpdates,visible:parts.filter(p=>p.group.visible).map(p=>p.data.id),sections:sections.entries.filter(e=>sections.root.visible&&e.group.visible).length,render:{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles},camera:{theta:rig.theta,phi:rig.phi,radius:rig.radius},selectedScreen:anatomy.selected?screenPoint(anatomy.selected):null}),
      catalogue:()=>data.parties.map(p=>p.id),
      coat:()=>parts.filter(p=>p.shell).map(p=>({id:p.data.id,layers:p.shell.geometry.instanceCount,hairs:p.hairs.map(h=>{
        const position=h.geometry.getAttribute('position'),normal=h.geometry.getAttribute('normal'),first=h.userData.fullRange[0]*data.poils.sommets_par_poil;
        return {batch:h.userData.batch,range:{...h.geometry.drawRange},indicesPerHair:h.userData.indicesPerHair,vertices:position.count,positionStride:position.data?.stride,normalOffset:normal.offset,colorOffset:h.geometry.getAttribute('color').offset,
          normals:h.userData.batch==='duvet'?null:[first,first+1].map(i=>[normal.getX(i),normal.getY(i),normal.getZ(i)])};
      })})),
      project:id=>{const p=parts.find(p=>p.data.id===id);return p?screenPoint(p):null;}};
    function screenPoint(p){const v=p.center.clone().add(p.offset).project(world.camera);return {x:(v.x+1)*innerWidth/2,y:(1-v.y)*innerHeight/2};}
  }
}catch(error){fallback(error);}
