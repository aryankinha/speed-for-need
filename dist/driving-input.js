// Frame independent exponential damping, following THREE.MathUtils.damp:
// https://threejs.org/docs/pages/MathUtils.html#damp
// Applied at fixed physics frequency; self-centering is quicker than turn-in.
export function smoothSteering(value,target,speed,dt){
  const center=target===0||value*target<0;
  const response=center?15:12/(1+Math.max(0,speed)/60);
  return value+(target-value)*(1-Math.exp(-response*Math.max(0,dt)));
}
export class RenderQuality {
  constructor(){this.ratio=1.5;this.slow=0;this.fast=0;}
  update(frameMs,dt){
    if(frameMs>25){this.slow+=dt;this.fast=0;}else if(frameMs<17){this.fast+=dt;this.slow=0;}else{this.slow=0;this.fast=0;}
    const before=this.ratio;if(this.slow>2.5&&this.ratio>1){this.ratio=Math.max(1,this.ratio-.25);this.slow=0;}if(this.fast>10&&this.ratio<1.5){this.ratio=Math.min(1.5,this.ratio+.25);this.fast=0;}return before!==this.ratio;
  }
}
