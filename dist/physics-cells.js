/** Static collision activation around every simulated vehicle, in world metres.
 * Call before stepping physics, and after teleports. A 300 m neighbour ring
 * comfortably covers the maximum driving distance between 0.25 s updates.
 */
export class PhysicsCells {
  constructor(objects,{cellSize=300,radiusCells=1}={}){
    if(!(Number.isFinite(cellSize)&&cellSize>0))throw new RangeError('cellSize must be positive.');
    if(!(Number.isInteger(radiusCells)&&radiusCells>=0))throw new RangeError('radiusCells must be a non-negative integer.');
    this.cellSize=cellSize;this.radiusCells=radiusCells;this.cells=new Map();this.entries=[];this.always=[];
    for(const actor of new Set(objects)){
      const body=actor?.body;
      // Never deactivate a moving body, even if its actor type is mislabeled.
      if(!body||actor.userData?.managedActivation||actor.type==='vehicle'||body.isDynamic?.()||body.getType?.()==='dynamic'||body.isKinematic?.()||body.getType?.()==='kinematic')continue;
      this.entries.push(actor);
      if(actor.userData?.alwaysActive||actor.userData?.kind==='boundary'){this.always.push(actor);continue;}
      // Register the full collider extent, rather than just its centre. Large
      // buildings straddling a cell edge must be ready on either approach.
      const bounds=actor.fixture?.getAABB?.(0),p=body.getPosition();
      const minX=Math.floor((bounds?.lowerBound.x??p.x)/cellSize),maxX=Math.floor((bounds?.upperBound.x??p.x)/cellSize);
      const minZ=Math.floor((bounds?.lowerBound.y??p.y)/cellSize),maxZ=Math.floor((bounds?.upperBound.y??p.y)/cellSize);
      for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++){
        const key=`${x},${z}`;if(!this.cells.has(key))this.cells.set(key,[]);this.cells.get(key).push(actor);
      }
    }
    this.totalCount=this.entries.length;this.activeCount=this.entries.reduce((count,a)=>count+Number(a.body.isActive()),0);
  }
  get stats(){return {activeCount:this.activeCount,totalCount:this.totalCount};}
  update(vehicles){
    const desired=new Set(this.always),visited=new Set();
    for(const actor of vehicles){
      const body=actor?.body;if(!body||!body.isActive())continue;
      const p=body.getPosition(),cx=Math.floor(p.x/this.cellSize),cz=Math.floor(p.y/this.cellSize);
      for(let x=cx-this.radiusCells;x<=cx+this.radiusCells;x++)for(let z=cz-this.radiusCells;z<=cz+this.radiusCells;z++){
        const key=`${x},${z}`;if(visited.has(key))continue;visited.add(key);
        for(const object of this.cells.get(key)||[])desired.add(object);
      }
    }
    for(const actor of this.entries){const enabled=desired.has(actor);if(actor.body.isActive()!==enabled)actor.body.setActive(enabled);}
    this.activeCount=desired.size;
    return this.stats;
  }
}
