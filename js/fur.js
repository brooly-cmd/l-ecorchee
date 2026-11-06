import * as T from 'three';
import {focusPatch,organicGLSL,furPigmentGLSL} from './materials.js';
// Two shifted Kajiya–Kay lobes around the actual strand direction. Stable in object space.
const fibreLight=`
  vec3 fibreV=normalize(vViewPosition),fibreT=normalize(vFibreTangent);
  vec3 fibreL=normalize((viewMatrix*vec4(-3.0,9.0,5.0,0.0)).xyz);
  vec3 fibreH=normalize(fibreL+fibreV);
  float tangentH=dot(fibreT,fibreH);
  float primary=pow(max(0.0,1.0-pow(clamp(tangentH+.12,-1.0,1.0),2.0)),45.0);
  float secondary=pow(max(0.0,1.0-pow(clamp(tangentH-.22,-1.0,1.0),2.0)),18.0);
  float grazing=pow(1.0-abs(dot(normal,fibreV)),2.0);
  float backscatter=pow(max(0.0,dot(-fibreL,fibreV)),3.0);
  outgoingLight+=(vec3(.052,.044,.037)*primary+vec3(.018,.014,.011)*secondary)*(.55+.45*grazing);
  outgoingLight+=diffuseColor.rgb*(grazing*.16+backscatter*.42);
`;
export function shells(geometry,part,plane,focus,comb){
  const geo=new T.InstancedBufferGeometry();geo.index=geometry.index;
  for(const key in geometry.attributes)geo.setAttribute(key,geometry.attributes[key]);
  geo.setAttribute('furLayer',new T.InstancedBufferAttribute(Float32Array.from({length:14},(_,i)=>(i+1)/14),1));
  geo.setAttribute('furBase',new T.InstancedBufferAttribute(Float32Array.from({length:14},(_,i)=>i===0?1:0),1));
  const nearLength={value:1},detail={value:1};
  const m=new T.MeshPhysicalMaterial({vertexColors:true,roughness:.86,clearcoat:0,specularIntensity:.18,sheen:.65,sheenColor:'#80756c',sheenRoughness:.8,side:T.FrontSide,clippingPlanes:[plane]});
  const reducedCoat={value:0};m.userData.reducedCoat=reducedCoat;
  m.onBeforeCompile=shader=>{
    // Only the short, dark undercoat uses shells; supplied curved strands carry the coat.
    shader.uniforms.uFurLength={value:part.fourrure_longueur*.38};
    shader.uniforms.uNearLength=nearLength;
    shader.uniforms.uCoatDetail=detail;
    shader.uniforms.uReducedCoat=reducedCoat;
    shader.uniforms.uFurComb={value:comb};shader.uniforms.uFurCenter={value:new T.Vector3(...part.centre)};shader.uniforms.uFurRadial={value:part.id==='carapace'?1:0};
    shader.vertexShader='attribute float furLayer,furBase; uniform float uFurLength,uNearLength,uFurRadial;uniform vec3 uFurComb,uFurCenter; varying float vFurHeight,vFurBase; varying vec3 vFurRoot; varying vec3 vFurNormal,vFibreTangent,vFurFlow;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      vFurRoot=position;vFurNormal=normal;vFurHeight=furLayer;vFurBase=furBase;
      vec3 guide=mix(uFurComb,position-uFurCenter+vec3(0,0,.25),uFurRadial);
      vec3 furFlow=normalize(guide-normal*dot(guide,normal)+normal*.08);
      vFurFlow=furFlow;
      transformed+=(normal*furLayer+furFlow*furLayer*furLayer*.55)*uFurLength*uNearLength;
      transformed=mix(transformed,position+normal*.0006,furBase);
      vFibreTangent=normalMatrix*normalize(normal+furFlow*furLayer*1.1);`);
    shader.fragmentShader=`uniform float uCoatDetail,uReducedCoat;varying float vFurHeight,vFurBase; varying vec3 vFurRoot; varying vec3 vFurNormal,vFibreTangent,vFurFlow;\n${organicGLSL}\n${furPigmentGLSL}\n`+shader.fragmentShader;
    focusPatch(shader,focus);
    shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
      // A frequency-modulated strand field, broken at irregular lengths. Unlike a noise
      // isocontour it cannot form broad islands, and unlike follicles it has no dot lattice.
      vec3 furN=abs(normalize(vFurNormal));
      vec2 furPlane=furN.y>max(furN.x,furN.z)?vFurRoot.xz:(furN.x>furN.z?vFurRoot.zy:vFurRoot.xy);
      vec2 flow=normalize((furN.y>max(furN.x,furN.z)?vFurFlow.xz:(furN.x>furN.z?vFurFlow.zy:vFurFlow.xy))+vec2(.00001));
      float across=dot(furPlane,vec2(flow.y,-flow.x)),along=dot(furPlane,flow);
      float phase=across*2900.0+tissueNoise(vFurRoot*75.0)*24.0+tissueNoise(vFurRoot*480.0)*4.0;
      #ifdef REDUCED_COAT
        phase=across*2200.0+tissueNoise(vFurRoot*75.0)*12.0;
      #endif
      float strand=.5+.5*sin(phase);
      float threshold=mix(.30,.94,pow(vFurHeight,.8));
      float furCoverage=step(threshold,strand);
      float endNoise=tissueNoise(vec3(across*1900.0,along*260.0,17.0));
      #ifdef REDUCED_COAT
        endNoise=tissueHash(floor(vec3(across*1900.0,along*260.0,17.0)));
      #endif
      furCoverage*=smoothstep(vFurHeight*.72-.12,vFurHeight*.72+.12,endNoise);
      float furFace=abs(dot(normalize(vNormal),normalize(vViewPosition)));
      furCoverage*=smoothstep(.025,.28,furFace)*mix(1.0,.55,vFurHeight);
      // Unresolved outer fibres disappear into the shaded base, never into a pale alpha veil.
      float footprint=fwidth(phase);
      furCoverage*=1.0-smoothstep(1.2,3.0,footprint);
      if(vFurBase<.5&&(vFurHeight>uCoatDetail||furFace<.22||furCoverage<.54))discard;`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      vec3 undercoatDye=furPigment(diffuseColor.rgb,vFurRoot);
      #ifdef REDUCED_COAT
        float skinRust=smoothstep(.025,.16,diffuseColor.r-diffuseColor.g);
        undercoatDye=mix(max(diffuseColor.rgb*1.75,vec3(.034,.028,.024)),diffuseColor.rgb*vec3(.64,.64,.7),skinRust)*mix(.60,1.16,tissueNoise(vFurRoot*36.0));
      #endif
      vec3 undercoatRoot=mix(undercoatDye*.23,vec3(.012,.009,.007),.4);
      float velvetGrain=tissueNoise(vFurRoot*820.0);
      #ifdef REDUCED_COAT
        velvetGrain=.5;
      #endif
      float velvetResolved=1.0-smoothstep(1.0,2.8,footprint);
      float velvetFibre=mix(velvetGrain,strand,velvetResolved*.65);
      diffuseColor.rgb=mix(undercoatRoot,undercoatDye*.62,pow(vFurHeight,1.4)*(1.0-vFurBase));
      if(uReducedCoat>.5)diffuseColor.rgb=undercoatDye*mix(.70,.88,vFurHeight*(1.0-vFurBase));
      diffuseColor.rgb*=mix(.72,1.3,velvetFibre);`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
      vec3 furAcross=cross(normal,normalize(vFibreTangent));furAcross/=max(length(furAcross),.0001);
      normal=tissueBump(normal,-vViewPosition,velvetFibre*.0012,.55);
      normal=normalize(normal+furAcross*cos(phase)*.22*(1.0-vFurBase)*(1.0-smoothstep(1.2,3.0,footprint)));`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <aomap_fragment>',`#include <aomap_fragment>
      reflectedLight.indirectDiffuse*=mix(.88,1.0,vFurHeight);
      reflectedLight.directDiffuse*=mix(.92,1.0,vFurHeight);`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`if(vFurBase<.5){${fibreLight}}
      else if(uReducedCoat>.5){outgoingLight+=diffuseColor.rgb*.20*pow(1.0-abs(dot(normal,normalize(vViewPosition))),3.0);}
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey=()=> 'ecorchee-fur-shell-v4';
  const mesh=new T.Mesh(geo,m);mesh.name=`fourrure_${part.id}`;mesh.renderOrder=1002;
  mesh.userData.parameters={comb};mesh.userData.detail=detail;
  const furCenter=new T.Vector3(...part.centre),worldCenter=new T.Vector3();
  mesh.onBeforeRender=(_renderer,_scene,camera)=>{
    worldCenter.copy(furCenter).applyMatrix4(mesh.matrixWorld);
    // A shorter undercoat up close keeps the layers below visual resolution.
    nearLength.value=T.MathUtils.lerp(.018,.12,T.MathUtils.smoothstep(camera.position.distanceTo(worldCenter),1,8));
  };
  geo.boundingBox=geometry.boundingBox?.clone();geo.boundingSphere=geometry.boundingSphere?.clone();
  if(geo.boundingSphere)geo.boundingSphere.radius+=part.fourrure_longueur;
  return mesh;
}
export function hairBuffer(buffer,format){
  const {octets_par_sommet:stride,sommets_par_poil:verticesPerHair,decalages:offset,index_relatifs:pattern}=format;
  const vertices=buffer.byteLength/stride,count=vertices/verticesPerHair,indicesPerHair=pattern.length;
  if(!Number.isInteger(count)||!count||stride%2||verticesPerHair%2!==1||pattern.some(i=>i<0||i>=verticesPerHair))throw Error('Format des poils incohérent');
  const pos=new T.InterleavedBuffer(new Int16Array(buffer),stride/Int16Array.BYTES_PER_ELEMENT);
  const norm=new T.InterleavedBuffer(new Int8Array(buffer),stride);
  const col=new T.InterleavedBuffer(new Uint8Array(buffer),stride);
  const tangent=new Float32Array(vertices*3),halfWidth=new Float32Array(vertices*3),height=new Float32Array(vertices),side=new Float32Array(vertices);
  const position=new T.InterleavedBufferAttribute(pos,3,offset.position/Int16Array.BYTES_PER_ELEMENT,true);
  const levels=(verticesPerHair+1)/2,centers=new Float32Array(levels*3),distances=new Float32Array(levels);
  for(let i=0;i<count;i++){
    const base=i*verticesPerHair;distances[0]=0;
    for(let level=0;level<levels;level++){
      const a=base+level*2,b=Math.min(a+1,base+verticesPerHair-1),j=level*3;
      centers[j]=(position.getX(a)+position.getX(b))*.5;
      centers[j+1]=(position.getY(a)+position.getY(b))*.5;
      centers[j+2]=(position.getZ(a)+position.getZ(b))*.5;
      if(level)distances[level]=distances[level-1]+Math.hypot(centers[j]-centers[j-3],centers[j+1]-centers[j-2],centers[j+2]-centers[j-1]);
    }
    // Follow each bend, rather than using one root-to-tip chord for the whole strand.
    for(let j=0;j<verticesPerHair;j++){
      const level=Math.floor(j/2),before=Math.max(0,level-1)*3,after=Math.min(levels-1,level+1)*3;
      const x=centers[after]-centers[before],y=centers[after+1]-centers[before+1],z=centers[after+2]-centers[before+2],length=Math.hypot(x,y,z)||1,v=base+j;
      tangent[v*3]=x/length;tangent[v*3+1]=y/length;tangent[v*3+2]=z/length;
      halfWidth[v*3]=position.getX(v)-centers[level*3];halfWidth[v*3+1]=position.getY(v)-centers[level*3+1];halfWidth[v*3+2]=position.getZ(v)-centers[level*3+2];
      height[v]=distances[level]/(distances[levels-1]||1);side[v]=j===verticesPerHair-1?0:j%2?1:-1;
    }
  }
  // Keep the supplied opposing side normals: they already describe a round fibre.
  const attributes={position,normal:new T.InterleavedBufferAttribute(norm,3,offset.normale,true),color:new T.InterleavedBufferAttribute(col,3,offset.couleur,true),fibreTangent:new T.BufferAttribute(tangent,3),fibreHalfWidth:new T.BufferAttribute(halfWidth,3),fibreHeight:new T.BufferAttribute(height,1),fibreSide:new T.BufferAttribute(side,1)};
  const indices=new Uint32Array(count*indicesPerHair);
  for(let i=0;i<count;i++)for(let j=0;j<indicesPerHair;j++)indices[i*indicesPerHair+j]=i*verticesPerHair+pattern[j];
  return {attributes,index:new T.BufferAttribute(indices,1),verticesPerHair,indicesPerHair};
}
export function hairs(shared,range,part,plane,focus,scale=8,encoded=true){
  const indicesPerHair=shared.indicesPerHair;
  const viewport=new T.Vector2(),renderViewport=new T.Vector4(),minimumHalf={value:.3};
  const geo=new T.BufferGeometry();for(const key in shared.attributes)geo.setAttribute(key,shared.attributes[key]);geo.setIndex(shared.index);geo.setDrawRange(range[0]*indicesPerHair,range[1]*indicesPerHair);
  geo.boundingBox=new T.Box3(new T.Vector3(...part.mini),new T.Vector3(...part.maxi)).expandByScalar(.24);geo.boundingSphere=new T.Sphere();geo.boundingBox.getBoundingSphere(geo.boundingSphere);
  const m=new T.MeshStandardMaterial({vertexColors:true,roughness:.45,metalness:0,alphaToCoverage:true,side:T.DoubleSide,clippingPlanes:[plane]});
  m.onBeforeCompile=shader=>{
    shader.vertexShader='attribute vec3 fibreTangent;attribute float fibreHeight,fibreSide;varying vec3 vFibreTangent,vHairRoot;varying float vHairHeight,vHairSide;\n'+shader.vertexShader;
    shader.uniforms.uHairScale={value:scale};
    shader.vertexShader='uniform float uHairScale;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>\ntransformed*=uHairScale;vHairRoot=transformed;vFibreTangent=normalMatrix*fibreTangent;vHairHeight=fibreHeight;vHairSide=fibreSide;`);
    if(encoded){
      shader.uniforms.uHairViewport={value:viewport};
      shader.uniforms.uHairMinimumHalf=minimumHalf;
      shader.vertexShader='attribute vec3 fibreHalfWidth;uniform vec2 uHairViewport;uniform float uHairMinimumHalf;\n'+shader.vertexShader;
      // Keep distant strands continuous under MSAA and refine the ribbon width up close.
      shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`
        vec3 strandHalf=fibreHalfWidth*uHairScale;
        vec4 strandCenter=projectionMatrix*modelViewMatrix*vec4(transformed-strandHalf,1.0);
        vec4 strandEdge=projectionMatrix*modelViewMatrix*vec4(transformed,1.0);
        float pixelHalf=length((strandEdge.xy/strandEdge.w-strandCenter.xy/strandCenter.w)*uHairViewport)*.5;
        float strandWidth=clamp(uHairMinimumHalf/max(pixelHalf,.0001),.5,8.0);
        transformed+=strandHalf*(strandWidth-1.0);
        #include <project_vertex>`);
    }
    if(encoded)shader.vertexShader=shader.vertexShader.replace('#include <color_vertex>','#include <color_vertex>\nvColor.rgb=pow(vColor.rgb,vec3(2.2));');
    focusPatch(shader,focus);
    shader.fragmentShader=`varying vec3 vFibreTangent,vHairRoot;varying float vHairHeight,vHairSide;\n${organicGLSL}\n${furPigmentGLSL}\n`+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      diffuseColor.rgb=furPigment(diffuseColor.rgb,vHairRoot)*mix(.48,1.45,pow(vHairHeight,.7));
      // Geometric MSAA resolves the widened subpixel ribbon. Expanding this alpha
      // ramp with fwidth(side) would erase distant hairs before MSAA could see them.
      diffuseColor.a*=1.0-smoothstep(.65,1.0,abs(vHairSide));`);
    if(!encoded)shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
      vec3 hairAcross=normalize(cross(normal,normalize(vFibreTangent)));
      normal=normalize(normal*sqrt(max(.05,1.0-vHairSide*vHairSide))+hairAcross*vHairSide*.65);`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`${fibreLight}\n#include <opaque_fragment>`);
  };
  m.customProgramCacheKey=()=> `ecorchee-hairs-coverage-v5-${encoded}`;
  const mesh=new T.Mesh(geo,m);mesh.name=`poils_${part.id}`;mesh.renderOrder=1003;mesh.userData.fullRange=range;mesh.userData.indicesPerHair=indicesPerHair;
  if(encoded)mesh.onBeforeRender=renderer=>{
    renderer.getCurrentViewport(renderViewport);viewport.set(renderViewport.z,renderViewport.w);
    // Preserve the approved CSS-space thickness as render density increases.
    minimumHalf.value=.3*Math.max(1,renderer.getPixelRatio());
  };
  return mesh;
}
export function setShellCount(mesh,count){
  mesh.geometry.instanceCount=count;mesh.visible=count>0;
  const a=mesh.geometry.getAttribute('furLayer');for(let i=0;i<count;i++)a.setX(i,(i+1)/count);a.needsUpdate=true;
}

// Sparse short guard hairs sampled once from the supplied skin; no model asset is changed.
// Their distance fade is continuous coverage in the shader; the submitted range stays fixed.
export function shortHairs(geometry,part,plane,focus,comb,mobile){
  const pos=geometry.getAttribute('position'),norm=geometry.getAttribute('normal'),col=geometry.getAttribute('color'),index=geometry.index;
  const triangles=(index?index.count:pos.count)/3,areas=new Float32Array(triangles);
  const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),ab=new T.Vector3(),ac=new T.Vector3();let area=0;
  for(let t=0;t<triangles;t++){
    a.fromBufferAttribute(pos,index?index.getX(t*3):t*3);b.fromBufferAttribute(pos,index?index.getX(t*3+1):t*3+1);c.fromBufferAttribute(pos,index?index.getX(t*3+2):t*3+2);
    area+=ab.subVectors(b,a).cross(ac.subVectors(c,a)).length()*.5;areas[t]=area;
  }
  const count=Math.min(mobile?18000:30000,Math.round(area*(mobile?850:16000))),vertices=count*5;
  const values=Object.fromEntries(['position','normal','color','fibreTangent'].map(k=>[k,new Float32Array(vertices*3)]));
  const heights=new Float32Array(vertices),sides=new Float32Array(vertices),ranks=new Float32Array(vertices),indices=new Uint32Array(count*9);
  let seed=part.id.split('').reduce((s,c)=>Math.imul(s,31)+c.charCodeAt(0),173)>>>0;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const root=new T.Vector3(),n=new T.Vector3(),d=new T.Vector3(),across=new T.Vector3(),v=new T.Vector3(),color=new T.Vector3();
  const pattern=[0,1,2,1,3,2,2,3,4];
  const put=(buffer,vertex,value)=>{const i=vertex*3;buffer[i]=value.x;buffer[i+1]=value.y;buffer[i+2]=value.z;};
  for(let h=0;h<count;h++){
    const sample=random()*area;let low=0,high=triangles-1;
    while(low<high){const mid=(low+high)>>>1;if(areas[mid]<sample)low=mid+1;else high=mid;}
    const r=Math.sqrt(random()),w0=1-r,w1=r*(1-random()),w2=1-w0-w1;
    root.set(0,0,0);n.set(0,0,0);color.set(0,0,0);
    for(let j=0;j<3;j++){
      const id=index?index.getX(low*3+j):low*3+j,w=j===0?w0:j===1?w1:w2;
      root.addScaledVector(v.fromBufferAttribute(pos,id),w);n.addScaledVector(v.fromBufferAttribute(norm,id),w);color.addScaledVector(v.fromBufferAttribute(col,id),w);
    }
    n.normalize();d.copy(comb).addScaledVector(n,-comb.dot(n)).normalize().multiplyScalar(.65).addScaledVector(n,.7).normalize();
    across.crossVectors(n,d);if(across.lengthSq()<.001)across.crossVectors(n,new T.Vector3(1,.2,.1));across.normalize();
    d.addScaledVector(across,(random()-.5)*.65).normalize();
    const length=Math.min(.014,part.fourrure_longueur*.26)*(.28+random()*.72),width=.00025+random()*.0002;
    root.addScaledVector(n,.0005);
    for(let j=0;j<5;j++){
      const vertex=h*5+j,height=j<2?0:j<4?.52:1,side=j===4?0:j%2?1:-1;
      ranks[vertex]=(h+.5)/count;
      v.copy(root).addScaledVector(d,length*height).addScaledVector(comb,length*height*height*.18).addScaledVector(across,side*width*(1-height*.75));
      put(values.position,vertex,v);put(values.normal,vertex,n);put(values.color,vertex,color);put(values.fibreTangent,vertex,d);heights[vertex]=height;sides[vertex]=side;
    }
    for(let j=0;j<9;j++)indices[h*9+j]=h*5+pattern[j];
  }
  const attributes=Object.fromEntries(Object.entries(values).map(([k,a])=>[k,new T.BufferAttribute(a,3)]));
  attributes.fibreHeight=new T.BufferAttribute(heights,1);attributes.fibreSide=new T.BufferAttribute(sides,1);
  attributes.fibreRank=new T.BufferAttribute(ranks,1);
  // This procedural short duvet has its own small topology, independent of the binary format.
  const mesh=hairs({attributes,index:new T.BufferAttribute(indices,1),indicesPerHair:indices.length/count},[0,count],part,plane,focus,1,false);
  mesh.name=`duvet_${part.id}`;mesh.userData.batch='duvet';
  // These small per-part coats belong to the same assembled specimen. Keep their
  // submission stable as a bounding box grazes the screen edge while rotating.
  mesh.frustumCulled=false;
  const amount={value:0},compile=mesh.material.onBeforeCompile;
  mesh.material.onBeforeCompile=shader=>{
    compile(shader);shader.uniforms.uDuvetAmount=amount;
    shader.vertexShader='attribute float fibreRank;varying float vFibreRank;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvFibreRank=fibreRank;');
    shader.fragmentShader='uniform float uDuvetAmount;varying float vFibreRank;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
      if(uDuvetAmount<=0.0)discard;`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>',`diffuseColor.a*=smoothstep(vFibreRank-.025,vFibreRank+.025,uDuvetAmount);
      #include <alphatest_fragment>`);
  };
  mesh.material.customProgramCacheKey=()=> 'ecorchee-duvet-stable-v1';
  const center=new T.Vector3(...part.centre),worldCenter=new T.Vector3();
  mesh.onBeforeRender=(_renderer,_scene,camera)=>{
    worldCenter.copy(center).applyMatrix4(mesh.matrixWorld);
    amount.value=1-T.MathUtils.smoothstep(camera.position.distanceTo(worldCenter),2.5,6);
  };
  return mesh;
}
