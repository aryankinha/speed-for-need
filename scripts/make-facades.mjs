// Generates the procedural tower facade textures in dist/assets/facades/ (original work, CC0, no third-party pixels).
// Tile: 12 m wide x 14.4 m tall (3 bays x 4 floors at 4 m x 3.6 m) for the four curtain-wall styles, 12 x 7.2 m for the storefront.
// Each style writes <name>-color.jpg and <name>-rough.jpg (glass is smooth, stone is rough); the storefront also writes an emissive map.
// Encoding: PNG via zlib, then macOS `sips` to JPEG (pure-JS JPEG encoders are not vendored). Run: node scripts/make-facades.mjs
import {deflateSync} from 'node:zlib';
import {mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';

const OUT=resolve(import.meta.dirname,'../dist/assets/facades');mkdirSync(OUT,{recursive:true});
const SS=2; // supersampling: draw at 2x, box-filter down
let seed=1;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
const crcT=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
const crc=b=>{let c=0xffffffff;for(const v of b)c=crcT[(c^v)&255]^(c>>>8);return(c^0xffffffff)>>>0;};
const chunk=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c]);};
function png(w,h,rgb){const raw=Buffer.alloc((w*3+1)*h);for(let y=0;y<h;y++){raw[y*(w*3+1)]=0;rgb.copy(raw,y*(w*3+1)+1,y*w*3,(y+1)*w*3);}const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
class Canvas{
  constructor(w,h){this.w=w*SS;this.h=h*SS;this.ow=w;this.oh=h;this.d=new Float32Array(this.w*this.h*3);}
  rect(x0,y0,x1,y1,c){const X0=Math.max(0,Math.round(x0*SS)),X1=Math.min(this.w,Math.round(x1*SS)),Y0=Math.max(0,Math.round(y0*SS)),Y1=Math.min(this.h,Math.round(y1*SS));
    for(let y=Y0;y<Y1;y++)for(let x=X0;x<X1;x++){const col=typeof c==='function'?c(x/SS,y/SS):c,i=(y*this.w+x)*3;this.d[i]=col[0];this.d[i+1]=col[1];this.d[i+2]=col[2];}}
  // Wraps horizontally so mullions on the tile edge continue into the neighbouring tile.
  wrapRect(x0,y0,x1,y1,c){this.rect(x0,y0,x1,y1,c);if(x0<0)this.rect(x0+this.ow,y0,x1+this.ow,y1,c);if(x1>this.ow)this.rect(x0-this.ow,y0,x1-this.ow,y1,c);}
  grain(amount,seedOffset=0){let s=seedOffset+7;for(let i=0;i<this.d.length;i+=3){s=(s*1664525+1013904223)>>>0;const n=((s/4294967296)-.5)*amount;this.d[i]+=n;this.d[i+1]+=n;this.d[i+2]+=n;}}
  rgb(){const out=Buffer.alloc(this.ow*this.oh*3);for(let y=0;y<this.oh;y++)for(let x=0;x<this.ow;x++)for(let ch=0;ch<3;ch++){let a=0;for(let sy=0;sy<SS;sy++)for(let sx=0;sx<SS;sx++)a+=this.d[((y*SS+sy)*this.w+x*SS+sx)*3+ch];out[(y*this.ow+x)*3+ch]=Math.max(0,Math.min(255,Math.round(a/(SS*SS)*255)));}return out;}
}
const mix=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
const mul=(a,k)=>[a[0]*k,a[1]*k,a[2]*k];
function save(name,canvas){const p=join(OUT,name+'.png'),j=join(OUT,name+'.jpg');writeFileSync(p,png(canvas.ow,canvas.oh,canvas.rgb()));
  execFileSync('sips',['-s','format','jpeg','-s','formatOptions','88',p,'--out',j],{stdio:'ignore'});unlinkSync(p);}

const W=512,H=512,BAYS=3,FLOORS=4,BW=W/BAYS,FH=H/FLOORS; // image y grows downward; a floor's slab/spandrel sits at its bottom
// Daylight reflection: a soft diagonal sky streak shared across panes plus a vertical sky-to-ground falloff per pane.
const streak=(x,y,k=.2)=>{const d=((x+y*.7)%(W*1.1))/(W*1.1);return Math.max(0,1-Math.abs(d-.5)*5)*k;};

function curtainWall({name,glassTop,glassBottom,mullion,spandrel,spandrelLine,lites=2,mullionPx=5,spandrelFrac=.26,litChance=.035,blindChance=.05,seedValue,metal=false}){
  seed=seedValue;const c=new Canvas(W,H),r=new Canvas(W,H);
  c.rect(0,0,W,H,mullion);r.rect(0,0,W,H,[.5,.5,.5]);
  for(let f=0;f<FLOORS;f++){const y0=f*FH,y1=(f+1)*FH,sp=y1-FH*spandrelFrac;
    for(let b=0;b<BAYS;b++)for(let l=0;l<lites;l++){
      const lw=BW/lites,x0=b*BW+l*lw+mullionPx/2,x1=b*BW+(l+1)*lw-mullionPx/2,gy0=y0+mullionPx/2,gy1=sp-1;
      const roll=rnd(),tone=.88+rnd()*.2;let top=mul(glassTop,tone),bot=mul(glassBottom,tone);
      if(roll<litChance){top=[.95,.8,.52];bot=[.78,.58,.36];}else if(roll<litChance+blindChance){top=mix(top,[.72,.7,.64],.45);bot=mix(bot,[.55,.5,.44],.45);}
      c.rect(x0,gy0,x1,gy1,(x,y)=>{const t=(y-gy0)/(gy1-gy0);const s=streak(x,y);return mix(mix(top,bot,t),[1,1,1],s);});
      r.rect(x0,gy0,x1,gy1,[.14,.14,.14]);
    }
    c.rect(0,sp,W,y1,(x,y)=>mix(spandrel,mul(spandrel,.7),(y-sp)/(y1-sp)));r.rect(0,sp,W,y1,[metal?.35:.7,metal?.35:.7,metal?.35:.7]);
    c.rect(0,sp,W,sp+2.5,spandrelLine);r.rect(0,sp,W,sp+2.5,[.4,.4,.4]);
  }
  c.grain(.025,seedValue);
  save(name+'-color',c);save(name+'-rough',r);
}

function concreteRibbon({name,concrete,glassTop,glassBottom,seedValue}){
  seed=seedValue;const c=new Canvas(W,H),r=new Canvas(W,H);
  c.rect(0,0,W,H,concrete);r.rect(0,0,W,H,[.86,.86,.86]);
  for(let f=0;f<FLOORS;f++){const y0=f*FH,y1=(f+1)*FH,wy0=y0+FH*.14,wy1=y0+FH*.62;
    for(let b=0;b<BAYS;b++){const x0=b*BW+6,x1=(b+1)*BW-6;const roll=rnd(),tone=.9+rnd()*.15;let top=mul(glassTop,tone),bot=mul(glassBottom,tone);
      if(roll<.03){top=[.85,.74,.55];bot=[.62,.5,.36];}else if(roll<.1){top=[.62,.6,.56];bot=[.46,.44,.4];}
      c.rect(x0,wy0,x1,wy1,(x,y)=>{const t=(y-wy0)/(wy1-wy0);return mix(mix(top,bot,t),[1,1,1],streak(x,y,.09));});r.rect(x0,wy0,x1,wy1,[.16,.16,.16]);
      c.rect(x0,wy0,x1,wy0+4,mul(concrete,.55));c.rect(x0,wy1-3,x1,wy1+4,mul(concrete,1.12)); // head shadow and projecting sill
      c.rect(x0+(x1-x0)/2-1.5,wy0,x0+(x1-x0)/2+1.5,wy1,mul(concrete,.4));r.rect(x0+(x1-x0)/2-1.5,wy0,x0+(x1-x0)/2+1.5,wy1,[.5,.5,.5]);
    }
    c.rect(0,y1-3,W,y1,mul(concrete,.78)); // slab joint
    // Soft board-marked variation in the spandrels so the stone never reads flat.
    c.rect(0,y0+FH*.62,W,y1-3,(x,y)=>mul(concrete,.97+.05*Math.sin(x*.21+f*3.1)));
  }
  c.grain(.07,seedValue);r.grain(.05,seedValue+3);
  save(name+'-color',c);save(name+'-rough',r);
}

function punched({name,stone,frame,glassTop,glassBottom,seedValue}){
  seed=seedValue;const c=new Canvas(W,H),r=new Canvas(W,H);
  c.rect(0,0,W,H,stone);r.rect(0,0,W,H,[.88,.88,.88]);
  for(let f=0;f<FLOORS;f++){const y0=f*FH;
    for(let b=0;b<BAYS;b++){
      const cx=b*BW+BW/2,x0=cx-BW*.3,x1=cx+BW*.3,wy0=y0+FH*.16,wy1=y0+FH*.76;
      c.rect(x0-5,wy0-6,x1+5,wy1+7,mul(stone,.62)); // reveal shadow
      c.rect(x0-3,wy0-3,x1+3,wy1+3,frame);r.rect(x0-3,wy0-3,x1+3,wy1+3,[.55,.55,.55]);
      const roll=rnd(),tone=.85+rnd()*.25;let top=mul(glassTop,tone),bot=mul(glassBottom,tone);
      if(roll<.1){top=[1,.84,.55];bot=[.82,.6,.36];}else if(roll<.22){top=mix(top,[.78,.74,.66],.5);bot=mix(bot,[.58,.54,.48],.5);}
      c.rect(x0,wy0,x1,wy1,(x,y)=>{const t=(y-wy0)/(wy1-wy0);return mix(mix(top,bot,t),[1,1,1],streak(x,y,.1));});r.rect(x0,wy0,x1,wy1,[.17,.17,.17]);
      c.rect(cx-1.5,wy0,cx+1.5,wy1,frame);c.rect(x0,wy0+(wy1-wy0)*.34,x1,wy0+(wy1-wy0)*.34+3,frame);
      c.rect(x0-8,wy1+3,x1+8,wy1+8,mul(stone,1.1)); // sill
    }
    c.rect(0,y0+FH-5,W,y0+FH,mul(stone,1.07)); // string course
  }
  c.grain(.08,seedValue);r.grain(.05,seedValue+9);
  save(name+'-color',c);save(name+'-rough',r);
}

// Storefront: 12 x 7.2 m (tile aspect 640 x 384), a double-height lit lobby / retail floor.
function storefront(){
  seed=77;const SW=640,SH=384,c=new Canvas(SW,SH),r=new Canvas(SW,SH),e=new Canvas(SW,SH);
  const stone=[.5,.5,.52];
  c.rect(0,0,SW,SH,stone);r.rect(0,0,SW,SH,[.8,.8,.8]);e.rect(0,0,SW,SH,[0,0,0]);
  const bay=SW/3,plinth=SH-26,glassTop=40,glassBottom=SH-24;
  // Signage band (dark with a coloured neon strip per bay) over the glazing, parapet cap above.
  c.rect(0,0,SW,glassTop-4,[.22,.23,.26]);
  const neon=[[1,.45,.3],[.4,.8,1],[1,.8,.35]];
  for(let b=0;b<3;b++){const nx0=b*bay+30,nx1=(b+1)*bay-30;c.rect(nx0,14,nx1,20,neon[b]);e.rect(nx0,14,nx1,20,mul(neon[b],.9));c.rect(nx0+8,24,nx1-8,28,mul(neon[b],.5));e.rect(nx0+8,24,nx1-8,28,mul(neon[b],.35));}
  c.rect(0,glassTop-4,SW,glassTop,[.1,.1,.11]);
  for(let b=0;b<3;b++){const x0=b*bay+6,x1=(b+1)*bay-6,mid=(x0+x1)/2;
    // Daytime storefront: sky-reflecting glass over a dim warm interior with a row of lit ceiling spots, counters and a bright door.
    c.rect(x0,glassTop,x1,glassBottom,(x,y)=>{const t=(y-glassTop)/(glassBottom-glassTop);const g=Math.max(0,1-Math.abs((x-mid)/((x1-x0)/2)));
      const interior=mix([.34,.27,.2],[.16,.13,.11],t);const glare=mix([.5,.62,.74],[.3,.4,.5],t);return mix(interior,glare,.38+.14*(1-t));});
    e.rect(x0,glassTop,x1,glassBottom,(x,y)=>{const t=(y-glassTop)/(glassBottom-glassTop);const g=Math.max(0,1-Math.abs((x-mid)/((x1-x0)/2)));const k=(.38-t*.2)*(.5+g*.5);return [.95*k,.72*k,.42*k];});
    r.rect(x0,glassTop,x1,glassBottom,[.1,.1,.1]);
    for(let k=0;k<5;k++){const lx=x0+14+k*(x1-x0-28)/4;c.rect(lx-5,glassTop+8,lx+5,glassTop+14,[1,.93,.75]);e.rect(lx-9,glassTop+6,lx+9,glassTop+18,[1,.85,.55]);}
    for(let s=0;s<2;s++){const sy=glassBottom-30-s*0+0;void sy;}
    c.rect(x0+10,glassBottom-34,x1-10,glassBottom-26,[.5,.4,.3]);c.rect(x0+10,glassBottom-26,x1-10,glassBottom,[.2,.17,.15]);
    for(let k=0;k<4;k++){const px=x0+18+k*(x1-x0-36)/4;const h=22+rnd()*34;c.rect(px,glassBottom-34-h,px+22,glassBottom-34,[.28+rnd()*.12,.24+rnd()*.1,.2]);e.rect(px,glassBottom-34-h,px+22,glassBottom-34-h+4,[.5,.38,.22]);}
    c.rect(mid-2,glassTop,mid+2,glassBottom,[.1,.1,.11]);
  }
  for(let b=0;b<=3;b++){c.wrapRect(b*bay-6,glassTop,b*bay+6,SH,[.14,.14,.15]);r.wrapRect(b*bay-6,glassTop,b*bay+6,SH,[.5,.5,.5]);}
  c.rect(0,plinth,SW,SH,[.18,.18,.2]);
  c.grain(.06,5);
  save('storefront-color',c);save('storefront-rough',r);save('storefront-emissive',e);
}

curtainWall({name:'glass-blue',glassTop:[.62,.78,.92],glassBottom:[.2,.36,.56],mullion:[.7,.74,.78],spandrel:[.13,.19,.27],spandrelLine:[.75,.8,.85],lites:2,seedValue:11});
curtainWall({name:'glass-teal',glassTop:[.42,.68,.68],glassBottom:[.07,.23,.27],mullion:[.1,.13,.14],spandrel:[.12,.18,.19],spandrelLine:[.3,.38,.38],lites:1,mullionPx:7,spandrelFrac:.3,litChance:.03,blindChance:.04,seedValue:23,metal:true});
concreteRibbon({name:'concrete-warm',concrete:[.8,.76,.68],glassTop:[.45,.55,.66],glassBottom:[.12,.19,.27],seedValue:37});
punched({name:'stone-cream',stone:[.86,.81,.7],frame:[.9,.88,.82],glassTop:[.5,.62,.74],glassBottom:[.13,.19,.27],seedValue:51});
storefront();
console.log('wrote facades to',OUT);
