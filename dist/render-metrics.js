// Lightweight frame/cost measurements; GPU queries are asynchronous and optional.
export class FrameMetrics{
  constructor(capacity=180){this.intervals=new Float32Array(capacity);this.costs=new Float32Array(capacity);this.index=0;this.count=0;this.workMs=0;this.gpuMs=null;}
  reset(){this.index=0;this.count=0;this.workMs=0;this.gpuMs=null;}
  record(interval,cost,gpu=null){if(!(interval>0&&Number.isFinite(interval)&&cost>=0&&Number.isFinite(cost)))return;this.intervals[this.index]=interval;this.costs[this.index]=cost;this.index=(this.index+1)%this.intervals.length;this.count=Math.min(this.count+1,this.intervals.length);this.workMs=this.workMs?this.workMs*.9+cost*.1:cost;if(gpu!==null&&Number.isFinite(gpu))this.gpuMs=gpu;}
  summary(){const frames=Array.from(this.intervals.subarray(0,this.count)).sort((a,b)=>a-b),costs=Array.from(this.costs.subarray(0,this.count)).sort((a,b)=>a-b),at=(data,q)=>data.length?data[Math.floor((data.length-1)*q)]:0;return {samples:this.count,frameP50:at(frames,.5),frameP95:at(frames,.95),cpuP50:at(costs,.5),cpuP95:at(costs,.95),gpuMs:this.gpuMs};}
}
export class GpuTimer{
  constructor(gl){this.gl=gl;this.ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');this.pending=null;this.active=null;this.value=null;this.frames=0;}
  poll(){const gl=this.gl,e=this.ext;if(!e||!this.pending)return this.value;if(gl.getParameter(e.GPU_DISJOINT_EXT)){gl.deleteQuery(this.pending);this.pending=null;this.value=null;return null;}if(gl.getQueryParameter(this.pending,gl.QUERY_RESULT_AVAILABLE)){this.value=gl.getQueryParameter(this.pending,gl.QUERY_RESULT)/1e6;gl.deleteQuery(this.pending);this.pending=null;}return this.value;}
  begin(){if(!this.ext||this.pending||++this.frames%15)return;const gl=this.gl;this.active=gl.createQuery();gl.beginQuery(this.ext.TIME_ELAPSED_EXT,this.active);}
  end(){if(!this.active)return;this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);this.pending=this.active;this.active=null;}
}

// EffectComposer renders several passes. Three's default autoReset leaves only
// the final fullscreen triangle in renderer.info, hiding the city's real cost.
export function measureRenderFrame(renderer,render){
  const info=renderer.info;if(!info){render();return;}
  const previous=info.autoReset;info.autoReset=false;info.reset();
  try{render();}finally{info.autoReset=previous;}
}
