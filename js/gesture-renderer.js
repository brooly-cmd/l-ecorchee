import * as T from 'three';

// Full-sized storage allocated once. A smaller viewport lowers gesture fill cost;
// its size then grows smoothly at rest, without reallocating a framebuffer.
export class GestureRenderer {
  constructor(renderer,scene,camera,weak){
    Object.assign(this,{renderer,scene,camera});this.minimum=weak?.7:.85;
    const size=renderer.getDrawingBufferSize(new T.Vector2());
    const type=renderer.getContext().getExtension('EXT_color_buffer_float')?T.HalfFloatType:T.UnsignedByteType;
    this.target=new T.WebGLRenderTarget(size.x,size.y,{type,depthBuffer:true,stencilBuffer:true,samples:0});
    this.target.texture.colorSpace=T.LinearSRGBColorSpace;
    this.scale={value:new T.Vector2(1,1)};
    const m=new T.ShaderMaterial({depthTest:false,depthWrite:false,uniforms:{uImage:{value:this.target.texture},uScale:this.scale},
      vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
      fragmentShader:'uniform sampler2D uImage;uniform vec2 uScale;varying vec2 vUv;void main(){gl_FragColor=texture2D(uImage,vUv*uScale);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}'
    });
    this.copyScene=new T.Scene();this.copyCamera=new T.Camera();this.copyScene.add(new T.Mesh(new T.PlaneGeometry(2,2),m));
    renderer.info.autoReset=false;
    addEventListener('resize',()=>this.resize());
  }
  resize(){const size=this.renderer.getDrawingBufferSize(new T.Vector2());this.target.setSize(size.x,size.y);}
  async prepare(){
    const r=this.renderer;r.initRenderTarget(this.target);
    r.setRenderTarget(this.target);await r.compileAsync(this.scene,this.camera);r.render(this.scene,this.camera);
    r.setRenderTarget(null);await r.compileAsync(this.copyScene,this.copyCamera);r.render(this.copyScene,this.copyCamera);
  }
  draw(detail){
    const r=this.renderer;r.info.reset();
    if(detail>=1){r.setRenderTarget(null);r.render(this.scene,this.camera);return;}
    const factor=this.minimum+(1-this.minimum)*detail;
    const width=Math.max(1,Math.round(this.target.width*factor)),height=Math.max(1,Math.round(this.target.height*factor));
    this.target.viewport.set(0,0,width,height);this.target.scissor.copy(this.target.viewport);this.target.scissorTest=true;
    this.scale.value.set(width/this.target.width,height/this.target.height);
    r.setRenderTarget(this.target);r.render(this.scene,this.camera);
    r.setRenderTarget(null);r.render(this.copyScene,this.copyCamera);
  }
}
