// Frame independent exponential damping, following THREE.MathUtils.damp:
// https://threejs.org/docs/pages/MathUtils.html#damp
// Applied at fixed physics frequency; self-centering is quicker than turn-in.
export function smoothSteering(value,target,speed,dt){
  const center=target===0||value*target<0;
  const response=center?15:12/(1+Math.max(0,speed)/60);
  return value+(target-value)*(1-Math.exp(-response*Math.max(0,dt)));
}
export class RenderQuality {
  constructor(max=1.5,min=1){this.max=max;this.min=min;this.ratio=max;this.slow=0;this.fast=0;this.starved=false;}
  /** Graphics presets set the pixel-ratio range; the current ratio is clamped into it. */
  setRange(max,min=Math.min(1,max)){this.max=max;this.min=min;this.ratio=Math.min(max,Math.max(min,this.ratio));this.starved=false;}
  update(frameMs,dt,workMs=null){
    if(!(dt>0&&Number.isFinite(dt)&&Number.isFinite(frameMs)))return false;
    const measured=Number.isFinite(workMs),cost=measured?workMs:frameMs;
    if(cost>(measured?20:25)){this.slow+=dt;this.fast=0;}else if(cost<(measured?13:17)&&frameMs<40){this.fast+=dt;this.slow=0;}else{this.slow=0;this.fast=0;}
    const before=this.ratio;if(this.slow>2.5){if(this.ratio>this.min){this.ratio=Math.max(this.min,this.ratio-.25);}else this.starved=true;this.slow=0;}if(this.fast>10&&this.ratio<this.max){this.ratio=Math.min(this.max,this.ratio+.25);this.fast=0;}return before!==this.ratio;
  }
}
