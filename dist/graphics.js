import * as THREE from 'three';
import {EffectComposer,RenderPass,EffectPass,Effect,EffectAttribute,SMAAEffect,BloomEffect,ToneMappingEffect,ToneMappingMode,HueSaturationEffect} from 'postprocessing';
import {N8AOPostPass} from 'n8ao';
import {GRAPHICS_PRESETS} from './graphics-presets.js';
export * from './graphics-presets.js';

// Contrast-adaptive sharpening (after AMD FidelityFX CAS): sharpens flat detail more than edges, so it restores texture clarity
// lost to sub-native render scale and SMAA without haloing. Runs as its own pass on tone-mapped colour (5 taps).
class SharpenEffect extends Effect{
  constructor(strength=.3){
    super('SharpenEffect',`uniform float strength;
void mainImage(const in vec4 inputColor,const in vec2 uv,out vec4 outputColor){
  vec3 c=texture2D(inputBuffer,uv).rgb,n=texture2D(inputBuffer,uv+vec2(0.,texelSize.y)).rgb,s=texture2D(inputBuffer,uv-vec2(0.,texelSize.y)).rgb,e=texture2D(inputBuffer,uv+vec2(texelSize.x,0.)).rgb,w=texture2D(inputBuffer,uv-vec2(texelSize.x,0.)).rgb;
  vec3 mn=min(c,min(min(n,s),min(e,w))),mx=max(c,max(max(n,s),max(e,w)));
  vec3 amp=sqrt(clamp(min(mn,1.-mx)/max(mx,vec3(1e-4)),0.,1.));
  vec3 k=-amp*mix(.125,.2,strength);
  outputColor=vec4(clamp((c+(n+s+e+w)*k)/(1.+4.*k),0.,1.),inputColor.a);
}`,{attributes:EffectAttribute.CONVOLUTION,uniforms:new Map([['strength',new THREE.Uniform(strength)]])});
  }
}

// Post-processing pipeline built on pmndrs/postprocessing + N8AO. Falls back to a direct render if the composer fails.
export class GraphicsPipeline{
  constructor(renderer,scene,camera){
    this.renderer=renderer;this.scene=scene;this.camera=camera;this.preset=null;this.composer=null;this.ao=null;this.bloom=null;this.failed=false;this.degraded=0;
  }
  apply(name){
    const preset=GRAPHICS_PRESETS[name]||GRAPHICS_PRESETS.medium;this.name=GRAPHICS_PRESETS[name]?name:'medium';this.preset=preset;this.degraded=0;
    this.dispose();
    try{this.build(preset);}catch(error){console.warn('Post-processing disabled:',error);this.failed=true;this.composer=null;}
    return preset;
  }
  build(preset){
    const renderer=this.renderer,size=renderer.getSize(new THREE.Vector2());
    const composer=new EffectComposer(renderer,{frameBufferType:THREE.HalfFloatType,multisampling:0});
    composer.addPass(new RenderPass(this.scene,this.camera));
    if(preset.ao){
      const ao=new N8AOPostPass(this.scene,this.camera,size.x,size.y);ao.setQualityMode(preset.aoQuality);
      Object.assign(ao.configuration,{aoRadius:2.4,distanceFalloff:1,intensity:2.6,halfRes:preset.ao==='half',depthAwareUpsampling:true,gammaCorrection:false,color:new THREE.Color(0x0d0a12)});
      composer.addPass(ao);this.ao=ao;
    }
    const effects=[new SMAAEffect({preset:preset.smaa})];
    // Bloom only on genuine highlights (sun glints, lights, nitro) so it never hazes the whole frame.
    if(preset.bloom){this.bloom=new BloomEffect({luminanceThreshold:1.35,luminanceSmoothing:.2,intensity:.22,mipmapBlur:true,radius:.5});effects.push(this.bloom);}
    // AgX keeps highlight colour and soft shoulder (no crushed shadows / clipped skies); a touch of saturation restores the LA palette.
    effects.push(new ToneMappingEffect({mode:ToneMappingMode.AGX}),new HueSaturationEffect({saturation:.12}));
    composer.addPass(new EffectPass(this.camera,...effects));
    if(preset.sharpen)composer.addPass(new EffectPass(this.camera,new SharpenEffect(preset.sharpen)));
    composer.setSize(size.x,size.y,false);this.composer=composer;
  }
  /** Steps quality down without a full rebuild when the frame budget is still missed at the lowest pixel ratio. */
  degrade(){
    if(!this.composer)return false;
    if(this.ao&&this.ao.enabled){if(!this.ao.configuration.halfRes){this.ao.configuration.halfRes=true;}else this.ao.enabled=false;this.degraded++;return true;}
    if(this.bloom&&this.bloom.blendMode.opacity.value>0){this.bloom.blendMode.opacity.value=0;this.degraded++;return true;}
    return false;
  }
  setSize(width,height){this.composer?.setSize(width,height,false);}
  render(delta){if(this.composer)this.composer.render(delta);else this.renderer.render(this.scene,this.camera);}
  dispose(){this.composer?.dispose();this.composer=null;this.ao=null;this.bloom=null;}
}
