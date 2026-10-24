// Resolve the same vendored Three modules as the browser's import map.
export async function resolve(specifier,context,next){
 if(specifier==='three')return {url:new URL('../dist/vendor/three.module.js',import.meta.url).href,shortCircuit:true};
 if(specifier.startsWith('three/addons/'))return {url:new URL('../dist/vendor/'+specifier.slice(13),import.meta.url).href,shortCircuit:true};
 return next(specifier,context);
}
