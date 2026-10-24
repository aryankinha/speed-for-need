#!/usr/bin/env python3
# Offline only: native glTF transforms -> clipped guardrail footprints -> chains.
# numpy + shapely are build tools; no Python dependency is used by the game.
import json,struct,collections,numpy as np
from pathlib import Path
import sys
p=sys.argv[1]
output=Path(sys.argv[2])
b=open(p,'rb').read();n=struct.unpack_from('<I',b,12)[0];j=json.loads(b[20:20+n]);base=28+n
D={5126:'<f4',5125:'<u4',5123:'<u2',5121:'u1',5122:'<i2'};N={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}
def acc(i):
 a=j['accessors'][i];v=j['bufferViews'][a['bufferView']];dt=np.dtype(D[a['componentType']]);c=N[a['type']];return np.ndarray((a['count'],c),dtype=dt,buffer=b,offset=base+v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',dt.itemsize*c),dt.itemsize))
meshes=[]
def visit(i,m,parent=''):
 n=j['nodes'][i];m=m@np.array(n.get('matrix',np.eye(4).flatten(order='F'))).reshape((4,4),order='F');name=n.get('name','');
 if 'mesh'in n:
  for pr in j['meshes'][n['mesh']]['primitives']:
   pos=acc(pr['attributes']['POSITION']);pos=(np.column_stack([pos,np.ones(len(pos))])@m.T)[:,:3];ix=acc(pr['indices']).ravel().reshape(-1,3);meshes.append({'name':parent,'pos':pos,'ix':ix,'material':pr.get('material')})
 for c in n.get('children',[]):visit(c,m,name)
for r in j['scenes'][0]['nodes']:visit(r,np.eye(4))
from shapely.geometry import Polygon,MultiPolygon
from shapely.ops import unary_union
from shapely import make_valid
import hashlib
road=next(m for m in meshes if m['name'].startswith('Road_'))
roadpoly=unary_union([Polygon(t[:,[0,2]])for t in road['pos'][road['ix']]])
contours=[]
def polygons(geom):
 if geom.geom_type=='Polygon':return [geom]
 return [p for g in geom.geoms for p in polygons(g)] if hasattr(geom,'geoms')else []
def clip(points,axis,level,positive):
 out=[]
 for i,a in enumerate(points):
  c=points[(i+1)%len(points)];aok=(a[axis]>=level)if positive else(a[axis]<=level);cok=(c[axis]>=level)if positive else(c[axis]<=level)
  if aok:out.append(a)
  if aok!=cok:out.append(a+(c-a)*((level-a[axis])/(c[axis]-a[axis])))
 return out
for m in meshes:
 if not m['name'].startswith(('Rails','Barrier')):continue
 parts=[]
 for t in m['pos'][m['ix']]:
  points=clip(t,1,.12,True)
  if len(points)<3:continue
  points=clip(points,1,1.15,False)
  if len(points)<3:continue
  poly=Polygon([(p[0],p[2])for p in points])
  if poly.area>1e-8:parts.append(poly)
 merged=make_valid(unary_union(parts)).buffer(.002).simplify(.025,preserve_topology=True)
 for poly in polygons(merged):
  if poly.area<.007:continue
  xy=list(poly.exterior.coords)[:-1]
  if len(xy)>=3:contours.append({'source':m['name'],'points':[[round(x,3),round(z,3)]for x,z in xy]})
# Native road boundary loops, for the GPS silhouette and surface containment.
roads=[]
for poly in polygons(roadpoly):
 for ring in [poly.exterior,*poly.interiors]:roads.append([[round(x,3),round(z,3)]for x,z in list(ring.simplify(.08).coords)[:-1]])
result={'sourceSha256':hashlib.sha256(b).hexdigest(),'scale':1,'roadY':round(float(road['pos'][:,1].mean()),6),'roadContours':roads,'walls':contours}

import heapq,math
from shapely.geometry import Point,LineString
road=roadpoly;data=result;walls=unary_union([Polygon(w['points'])for w in data['walls']]);drive=road.difference(walls.buffer(1.8)).buffer(-2.2);cache={}
def cost(p):
 if p not in cache:
  q=Point(p)
  cache[p]=1+5/(drive.boundary.distance(q)+1) if drive.contains(q) else math.inf
 return cache[p]
def snap(p):
 p=tuple(round(v)for v in p)
 good=[]
 for dx in range(-14,15):
  for dz in range(-14,15):
   q=(p[0]+dx,p[1]+dz)
   if math.isfinite(cost(q)):good.append((math.hypot(dx,dz)*.055+8/(road.boundary.distance(Point(q))+1),q))
 if good:return min(good)[1]
 raise ValueError(p)
def astar(a,b):
 queue=[(0,a)];prev={};g={a:0}
 while queue:
  _,p=heapq.heappop(queue)
  if p==b:
   path=[p]
   while p!=a:p=prev[p];path.append(p)
   return path[::-1]
  for dx,dz in [(1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)]:
   q=(p[0]+dx,p[1]+dz);v=g[p]+math.hypot(dx,dz)*cost(q)
   if v<g.get(q,math.inf):g[q]=v;prev[q]=p;heapq.heappush(queue,(v+math.dist(q,b),q))
 raise ValueError((a,b))
anchors=[[-40,85],[-140,-22],[-128,-70],[-105,-108],[-78,-119],[-20,-103],[35,-83],[65,-55],[61,-38],[30,-23],[5,-17],[-25,-24],[-50,-45],[-58,-65],[-80,-82],[-101,-78],[-117,-52],[-121,-24],[-65,37],[-30,70],[0,93],[22,100],[47,101],[63,115],[60,141],[47,162],[33,166],[18,150],[-10,118],[-40,85]]
anchors=[snap(p) for p in anchors];
route=[]
for a,b in zip(anchors,anchors[1:]):route+=astar(a,b)[:-1]
# Uniform 3.5 m samples are smoothed, then reduced with 0.3 m tolerance.
line=LineString(route+[route[0]])
points=np.array([line.interpolate(float(d)).coords[0]for d in np.arange(0,line.length,3.5)])
for _ in range(3):points=(np.roll(points,1,axis=0)+points*2+np.roll(points,-1,axis=0))/4
line=LineString(list(points)+[points[0]]).simplify(.3,preserve_topology=False);points=list(line.coords)[:-1];data['route']=[{'x':x,'z':z}for x,z in points]

output.write_text('// Generated from the supplied native-metre GLB. See docs/research/DRIFT_TRACK_INTEGRATION.md.\nexport const DRIFT_TRACK_DATA='+json.dumps(data,separators=(',',':'))+';\n')
print('wrote',output,'walls',len(data['walls']),'route points',len(data['route']))
