import * as T from 'three';
const recipes={cuticule:[.63,.18],griffe:[.18,.95],oeil:[.055,1],organe:[.39,.58],muscle:[.43,.48],nerf:[.41,.5],coeur:[.35,.68],poumon:[.47,.3],soie:[.34,.65]};
// Continuous object-space noise: no screen-space randomness, no swimming on rotation.
export const organicGLSL=`
float tissueHash(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
float tissueNoise(vec3 p){
  vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(mix(tissueHash(i),tissueHash(i+vec3(1,0,0)),f.x),mix(tissueHash(i+vec3(0,1,0)),tissueHash(i+vec3(1,1,0)),f.x),f.y),
    mix(mix(tissueHash(i+vec3(0,0,1)),tissueHash(i+vec3(1,0,1)),f.x),mix(tissueHash(i+vec3(0,1,1)),tissueHash(i+vec3(1)),f.x),f.y),f.z);
}
// Derivative bump from the SAME field as the pigment, preserving the geometric normal.
vec3 tissueBump(vec3 n,vec3 eye,float height,float strength){
  vec3 px=dFdx(eye),py=dFdy(eye),r1=cross(py,n),r2=cross(n,px);
  float det=dot(px,r1);
  return normalize(n-sign(det)*strength*(dFdx(height)*r1+dFdy(height)*r2)/max(abs(det),.000001));
}
`;
// Shared dye response for the cuticle, undercoat and actual strands (linear colours).
export const furPigmentGLSL=`
vec3 furPigment(vec3 c,vec3 p){
  float rust=smoothstep(.025,.16,c.r-c.g);
  float mottling=tissueNoise(p*36.0+3.0*tissueNoise(p*7.0));
  vec3 black=max(c*1.75,vec3(.034,.028,.024));
  vec3 orange=c*vec3(.64,.64,.7);
  return mix(black,orange,rust)*mix(.60,1.16,mottling);
}
`;
export function focusPatch(shader,focus){
  shader.uniforms.uFocus=focus;
  shader.fragmentShader='uniform float uFocus;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
    float atelierLuma=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
    diffuseColor.rgb=mix(vec3(atelierLuma*.56+.055),diffuseColor.rgb,uFocus);`);
}
export function physical(part,plane,maps,focus){
  const [roughness,clearcoat]=recipes[part.mat]||recipes.organe;
  const m=new T.MeshPhysicalMaterial({vertexColors:true,roughness,clearcoat,clearcoatRoughness:.24,alphaToCoverage:true,clippingPlanes:[plane],clipShadows:true,side:T.DoubleSide});
  m.name=part.id;
  const tissue=!['cuticule','griffe','oeil'].includes(part.mat);
  if(part.mat==='cuticule'){m.normalMap=maps.cuticule;m.normalScale.set(.36,.36);m.clearcoatRoughness=.2;}
  else if(tissue){m.normalMap=part.mat==='muscle'?maps.muscle:maps.organe;m.normalScale.set(.11,.11);m.envMapIntensity=.72;m.specularIntensity=.7;m.clearcoatRoughness=.16;}
  else {m.envMapIntensity=1;m.clearcoatRoughness=part.mat==='oeil'?.035:.1;m.ior=1.46;}
  const center=new T.Vector3(...part.centre),extent=new T.Vector3(...part.maxi).sub(new T.Vector3(...part.mini));
  const axis=part.groupe==='muscles'&&Math.abs(center.x)>.2?new T.Vector3(center.x,0,center.z).normalize():new T.Vector3(0,0,1);
  m.onBeforeCompile=shader=>{
    focusPatch(shader,focus);
    Object.assign(shader.uniforms,{uTissueCenter:{value:center},uTissueExtent:{value:extent},uTissueAxis:{value:axis},uCavityPlane:maps.cavity.plane,uCavity:maps.cavity.amount,uVessels:{value:maps.vessels}});
    shader.vertexShader='varying vec3 vSpecimen; varying vec3 vTissueWorld;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvSpecimen=position;vTissueWorld=(modelMatrix*vec4(position,1.0)).xyz;');
    shader.fragmentShader=`varying vec3 vSpecimen; varying vec3 vTissueWorld; uniform vec3 uTissueCenter,uTissueExtent,uTissueAxis; uniform vec4 uCavityPlane; uniform float uCavity; uniform sampler2D uVessels;\n${organicGLSL}\n${furPigmentGLSL}\n`+shader.fragmentShader;
    if(part.mat==='muscle'){
      // The supplied loft UVs wrap each bundle separately, including the curved leg muscles.
      // A global axis paints rings across some thorax bundles instead of lengthwise fibres.
      shader.vertexShader='varying vec2 vTissueUv;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvTissueUv=uv;');
      shader.fragmentShader='varying vec2 vTissueUv;\n'+shader.fragmentShader;
    }
    const field=`
      vec3 tp=vSpecimen-uTissueCenter;
      float macroDetail=1.0-smoothstep(.002,.018,max(length(dFdx(vSpecimen)),length(dFdy(vSpecimen))));
      float marble=tissueNoise(vSpecimen*22.0+4.0*tissueNoise(vSpecimen*7.0));
      float grain=tissueNoise(vSpecimen*175.0);
      float vesselField=tissueNoise(vSpecimen*85.0+vec3(marble*2.5));
      float vesselAA=max(fwidth(vesselField)*.65,.003);
      ${tissue?`vec3 tissueN=abs(normalize(cross(dFdx(vSpecimen),dFdy(vSpecimen))));
      tissueN=pow(tissueN,vec3(4.0));tissueN/=max(.0001,tissueN.x+tissueN.y+tissueN.z);
      vec3 vesselSamples=vec3(texture2D(uVessels,vSpecimen.yz*1.7).r,texture2D(uVessels,vSpecimen.xz*1.7).r,texture2D(uVessels,vSpecimen.xy*1.7).r);
      float vessel=dot(tissueN,vesselSamples)*macroDetail;`:`float vessel=(1.0-smoothstep(.004,.013+vesselAA,abs(vesselField-.49)))*smoothstep(.27,.62,marble)*macroDetail;`}
      float tissueHeight=marble*.012+grain*.002-vessel*.0014;
      float tissueDepth=max(0.0,dot(vec4(vTissueWorld,1.0),uCavityPlane));
      float enclosure=max(1.0-smoothstep(.65,1.3,length((vSpecimen-vec3(0,.826,-1.17))/vec3(.74,.72,.89))),
        1.0-smoothstep(.65,1.3,length((vSpecimen-vec3(0,.77,.37))/vec3(.6,.4,.65))));
      float cavity=mix(1.0,mix(.94,.43,smoothstep(.015,.8,tissueDepth))*mix(1.0,.88,enclosure),uCavity);
    `;
    let pigment='',normal='',rough='',rim='';
    if(tissue){
      pigment=`diffuseColor.rgb*=mix(.87,1.09,marble)*mix(1.0,.87+.2*grain,macroDetail);
        diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.49,.21,.24),vessel*.22);
        diffuseColor.rgb*=cavity;`;
      if(part.mat==='muscle')pigment+=`
        float fibrePhase=vTissueUv.x*240.0+sin(vTissueUv.y*11.0)*.6+marble*1.2;
        float fibreFilter=1.0-smoothstep(1.5,3.14,fwidth(fibrePhase));
        float muscleFibre=(.5+.5*sin(fibrePhase)*fibreFilter)*macroDetail;
        tissueHeight+=muscleFibre*.009;diffuseColor.rgb*=.78+.26*muscleFibre;`;
      if(part.mat==='poumon')pigment+=`float leaf=.5+.5*sin(tp.z*766.2);tissueHeight+=leaf*.001;diffuseColor.rgb*=.88+.12*leaf;`;
      if(part.id==='cerveau')pigment+=`float fold=abs(sin(tp.z*94.0+sin(tp.x*66.0)*1.8+marble*2.0));tissueHeight+=fold*.025;diffuseColor.rgb*=.65+.35*smoothstep(.1,.6,fold);`;
      if(part.id==='diverticules')pigment+=`
        float lobe=tissueNoise(vSpecimen*8.0),ochre=tissueNoise(vSpecimen*4.0+vec3(8.0));
        vec3 lobeDye=mix(vec3(.53,.22,.095),vec3(.87,.61,.20),smoothstep(.22,.74,ochre));
        diffuseColor.rgb=mix(diffuseColor.rgb,lobeDye*.42*cavity,.6)*mix(.65,1.12,smoothstep(.24,.67,lobe));`;
      // Keep the mesh's dark heart valves; never paint over them with a generic stripe.
      normal='normal=tissueBump(normal,-vViewPosition,tissueHeight,.12*macroDetail);';
      rough='roughnessFactor=clamp(roughnessFactor+(marble-.5)*.22+vessel*.08,.24,.64);';
      rim=`float tissueRim=pow(1.0-abs(dot(normal,normalize(vViewPosition))),3.0);
        vec3 tissueLight=normalize((viewMatrix*vec4(-3.0,9.0,5.0,0.0)).xyz);
        float wrapped=max(0.0,(dot(normal,tissueLight)+.45)/1.45);
        outgoingLight+=diffuseColor.rgb*vec3(1.0,.43,.28)*tissueRim*(.13+.25*wrapped)*cavity;`;
    }else if(part.mat==='cuticule'){
      pigment=`float membrane=step(.095,diffuseColor.g)*step(diffuseColor.g*.48,diffuseColor.b)*step(diffuseColor.g*1.18,diffuseColor.r);
        ${part.fourrure_longueur?`diffuseColor.rgb=mix(furPigment(diffuseColor.rgb,vSpecimen)*.76,diffuseColor.rgb,membrane);`:''}
        diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.47,.32,.34)*mix(.75,1.2,marble),membrane);
        diffuseColor.rgb*=mix(1.0,.58,vessel*membrane)*mix(1.0,cavity,membrane);
        tissueHeight=mix(grain*.006,marble*.012-vessel*.002,membrane);`;
      rough=`roughnessFactor=mix(${part.fourrure_longueur?'.88':'.58'}+(grain-.5)*.10,.3+(marble-.5)*.16,membrane);`;
      normal='normal=tissueBump(normal,-vViewPosition,tissueHeight,.2*macroDetail);';
    }else if(part.mat==='griffe'){
      pigment=`float tip=clamp((uTissueCenter.y+uTissueExtent.y*.5-vSpecimen.y)/max(uTissueExtent.y,.01),0.0,1.0);
        diffuseColor.rgb=mix(vec3(.12,.027,.012),vec3(.004,.002,.002),smoothstep(.22,.86,tip))*(.9+.15*grain);
        tissueHeight=grain*.001;`;
      rough='roughnessFactor=.12+.1*marble;';
      normal='normal=tissueBump(normal,-vViewPosition,tissueHeight,.12);';
      rim='outgoingLight+=diffuseColor.rgb*vec3(1.0,.3,.12)*pow(1.0-abs(dot(normal,normalize(vViewPosition))),4.0)*.45;';
    }else{
      // Dark absorbing lens under a polished dielectric cornea, with real scene reflections.
      pigment='diffuseColor.rgb*=.36;';
      rough='roughnessFactor=.045;';
    }
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>\n${field}\n${pigment}`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>\n${rough}`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>\n${normal}`);
    if(tissue||part.mat==='cuticule')shader.fragmentShader=shader.fragmentShader.replace('#include <clearcoat_normal_fragment_maps>',`#include <clearcoat_normal_fragment_maps>
      #ifdef USE_CLEARCOAT
        clearcoatNormal=normal;
      #endif`);
    if(tissue)shader.fragmentShader=shader.fragmentShader.replace('#include <aomap_fragment>',`#include <aomap_fragment>
      reflectedLight.indirectSpecular*=cavity;reflectedLight.directSpecular*=sqrt(cavity);
      #ifdef USE_CLEARCOAT
        clearcoatSpecularDirect*=sqrt(cavity);clearcoatSpecularIndirect*=cavity;
      #endif`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`${rim}\n#include <opaque_fragment>`);
  };
  m.customProgramCacheKey=()=>`ecorchee-tissue-v3-${part.mat}-${part.id==='cerveau'}-${part.id==='diverticules'}-${!!part.fourrure_longueur}`;
  return m;
}
export function sectionMaterial(color,focus,blue=false,edge=null){
  const m=new T.MeshPhysicalMaterial({color,roughness:blue?.48:.4,clearcoat:blue?.22:.6,clearcoatRoughness:.19,envMapIntensity:.65,specularIntensity:.65,side:T.DoubleSide,
    stencilWrite:true,stencilRef:0,stencilFunc:T.NotEqualStencilFunc,stencilFail:T.ReplaceStencilOp,stencilZFail:T.ReplaceStencilOp,stencilZPass:T.ReplaceStencilOp,
    polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
  m.onBeforeCompile=shader=>{
    focusPatch(shader,focus);
    shader.vertexShader='varying vec2 vTissue;varying vec3 vCapWorld;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvTissue=position.xy;vCapWorld=(modelMatrix*vec4(position,1.0)).xyz;');
    shader.fragmentShader=`varying vec2 vTissue;varying vec3 vCapWorld;\n${organicGLSL}\n`+shader.fragmentShader;
    if(blue&&edge){Object.assign(shader.uniforms,{uEdgeMap:{value:edge.texture},uSectionAxis:edge.axis,uEdgeStrength:edge.strength});shader.fragmentShader='uniform sampler2D uEdgeMap;uniform int uSectionAxis;uniform float uEdgeStrength;\n'+shader.fragmentShader;}
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      vec3 cellP=vec3(vTissue*135.0,7.0);
      float cell=tissueNoise(cellP),marble=tissueNoise(vec3(vTissue*28.0,4.0));
      float cellAA=max(fwidth(cell),.015);
      vec2 vesselCell=floor(vTissue*82.0),vesselOffset=fract(vTissue*82.0)-vec2(tissueHash(vec3(vesselCell,3.0)),tissueHash(vec3(vesselCell,9.0)));
      float vessels=(1.0-smoothstep(.045,.12,length(vesselOffset)))*step(.81,tissueHash(vec3(vesselCell,5.0)));
      float cutHeight=cell*.005+marble*.009;
      diffuseColor.rgb*=mix(.76,1.1,marble)*(.91+.17*cell);
      ${blue?`vec2 edgeUV=(uSectionAxis==0?vCapWorld.zy:(uSectionAxis==1?vCapWorld.xz:vCapWorld.xy))/10.0+.5;
        float edgeBlack=texture2D(uEdgeMap,edgeUV).r*uEdgeStrength;
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.006,.009,.014),edgeBlack*.94);`:`diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.3,.06,.1),vessels*.7);`}`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=clamp(roughnessFactor+(cell-.5)*.17,.27,.58);');
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\nnormal=tissueBump(normal,-vViewPosition,cutHeight,.18);');
    shader.fragmentShader=shader.fragmentShader.replace('#include <clearcoat_normal_fragment_maps>','#include <clearcoat_normal_fragment_maps>\n#ifdef USE_CLEARCOAT\nclearcoatNormal=normal;\n#endif');
  };
  m.customProgramCacheKey=()=>`ecorchee-section-v2-${blue}`;
  return m;
}
