import * as T from 'three';

// Keep the same multisampled canvas and fixed resolution throughout the session.
// The former smaller, non-MSAA target changed strand coverage at gesture boundaries.
export class GestureRenderer {
  constructor(renderer,scene,camera){
    Object.assign(this,{renderer,scene,camera});
    this.scale={value:new T.Vector2(1,1)};
    renderer.info.autoReset=false;
  }
  resize(){}
  async prepare(){
    await this.renderer.compileAsync(this.scene,this.camera);
    this.renderer.render(this.scene,this.camera);
  }
  draw(){
    const r=this.renderer;r.info.reset();
    r.setRenderTarget(null);r.render(this.scene,this.camera);
  }
}
