import * as THREE from './vendor/three.module.js';
import {addVehiclePlatform} from './vehicle-stage.js';

// The room is the downloaded, baked-light garage asset. Only vehicle staging and
// inexpensive fill lights are added here; its textures and authored scale stay intact.
export class GarageScene {
  constructor({scene,camera,rides,interior}) {
    if(!interior?.isObject3D)throw new TypeError('GarageScene needs its downloaded interior.');
    this.camera=camera;
    this.position=new THREE.Vector3(3000,0,0);
    this.root=new THREE.Group();
    this.root.name='Vehicle garage';
    this.root.position.copy(this.position);
    this.root.visible=false;
    scene.add(this.root);
    this.selected=null;
    this.count=Object.keys(rides).length;
    this.angle=.8;this.manual=false;this.drag=null;
    this.reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false;
    this.target=new THREE.Vector3();

    interior.updateMatrixWorld(true);
    const roomBounds=new THREE.Box3().setFromObject(interior,true);
    if(roomBounds.isEmpty())throw new Error('Garage interior has no geometry.');
    const center=roomBounds.getCenter(new THREE.Vector3());
    interior.position.x-=center.x;
    interior.position.z-=center.z;
    interior.position.y-=roomBounds.min.y;
    interior.traverse(node=>{
      if(node.isMesh){
        // Authored emissive/occlusion textures supply the room lighting. Casting
        // the whole room into the moving sun map wastes work and shadows the car.
        node.castShadow=false;
        node.receiveShadow=false;
      }
    });
    this.root.add(interior);

    this.turntable=new THREE.Group();
    this.turntable.name='Selected garage vehicle';
    this.root.add(this.turntable);
    addVehiclePlatform(this.root,this.turntable);
    this.cars={};
    for(const [id,ride] of Object.entries(rides)){
      const car=ride.group.clone(true);
      // Normalized player models are centred in X/Z and grounded in Y already.
      // Keep their metre scale so even the SUV fits the authored 3.58 m ceiling.
      car.position.set(0,.27,0);
      car.visible=false;
      this.cars[id]=car;
      this.turntable.add(car);
    }

    const key=new THREE.DirectionalLight(0xe6eeff,2.2);
    key.position.set(-4,3,3);
    key.target.position.set(0,.7,0);
    const rim=new THREE.DirectionalLight(0xffd9b0,1.3);
    rim.position.set(4,2.8,-3);
    rim.target.position.set(0,.7,0);
    const ambient=new THREE.HemisphereLight(0xdce8ff,0x39363a,.65);
    this.root.add(key,key.target,rim,rim.target,ambient);
  }

  select(id){
    if(!Object.hasOwn(this.cars,id))return false;
    this.selected=id;
    for(const [name,car] of Object.entries(this.cars))car.visible=name===id;
    return true;
  }

  show(id){
    if(!this.select(id))return false;
    this.root.visible=true;
    this.turntable.rotation.y=this.angle;
    this.frame();
    return true;
  }

  hide(){this.root.visible=false;this.endDrag();}

  bindInteraction(surface){
    this.surface=surface;
    surface.addEventListener('pointerdown',event=>{if(!this.root.visible||event.button!==0||this.drag)return;this.manual=true;this.drag={id:event.pointerId,x:event.clientX};surface.setPointerCapture(event.pointerId);});
    surface.addEventListener('pointermove',event=>{if(this.drag?.id!==event.pointerId)return;this.angle+=(event.clientX-this.drag.x)*.009;this.drag.x=event.clientX;this.turntable.rotation.y=this.angle;});
    for(const type of ['pointerup','pointercancel','lostpointercapture'])surface.addEventListener(type,event=>{if(this.drag?.id===event.pointerId)this.endDrag();});
    surface.addEventListener('keydown',event=>{if(!this.root.visible||!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();event.stopPropagation();this.manual=true;this.angle+=event.key==='ArrowLeft'?-.15:.15;this.turntable.rotation.y=this.angle;});
  }

  endDrag(){const id=this.drag?.id;this.drag=null;if(id!==undefined&&this.surface?.hasPointerCapture(id))this.surface.releasePointerCapture(id);}

  frame(){
    const portrait=this.camera.aspect<1;
    this.camera.position.set(this.position.x-7,2.5,this.position.z+7);
    this.target.set(this.position.x,.15,this.position.z);
    this.camera.up.set(0,1,0);this.camera.near=.12;
    this.camera.fov=portrait?58:45;
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
  }

  update(dt){
    if(!this.root.visible)return;
    if(!this.manual&&!this.reduced&&Number.isFinite(dt)&&dt>0)this.angle=(this.angle+Math.min(dt,.05)*.08)%(Math.PI*2);
    this.turntable.rotation.y=this.angle;
    this.surface?.setAttribute('aria-valuenow',String(Math.round(((this.angle*180/Math.PI)%360+360)%360)));
    this.frame();
  }
}
