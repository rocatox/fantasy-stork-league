import {trailSegments} from './map-geometry.mjs';
// Display-only levels of detail. Never used for GPS screening, replay or scoring.
export const TRAIL_TOLERANCES=[.00001,.0001,.001,.01,.1,1];
function simplify(run,tolerance){
 const keep=new Set([0,run.length-1]),stack=[[0,run.length-1]],limit=tolerance*tolerance;
 while(stack.length){const [a,b]=stack.pop(),p=run[a].xy,q=run[b].xy,dx=q[0]-p[0],dy=q[1]-p[1],len=dx*dx+dy*dy;let max=limit,at=-1;
  for(let i=a+1;i<b;i++){const r=run[i].xy,t=len?Math.max(0,Math.min(1,((r[0]-p[0])*dx+(r[1]-p[1])*dy)/len)):0,d=(r[0]-p[0]-t*dx)**2+(r[1]-p[1]-t*dy)**2;if(d>max){max=d;at=i;}}
  if(at>=0){keep.add(at);stack.push([a,at],[at,b]);}
 }
 const indexes=[...keep].sort((a,b)=>a-b);return indexes.slice(1).map((b,i)=>({index:run[indexes[i]].index,endIndex:run[b].index,from:run[indexes[i]].xy,to:run[b].xy,at:run[indexes[i]].time,bt:run[b].time}));
}
export function prepareTrail(points){
 const segments=trailSegments(points).map(s=>({...s,endIndex:s.index+1,at:Date.parse(points[s.index][2]),bt:Date.parse(points[s.index+1][2])}));
 const runs=[];let run=[];for(const s of segments){if(run.length&&run.at(-1).index!==s.index){runs.push(run);run=[];}if(!run.length)run.push({xy:s.from,index:s.index,time:s.at});run.push({xy:s.to,index:s.endIndex,time:s.bt});}if(run.length)runs.push(run);
 let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;for(const p of points){minX=Math.min(minX,p[0]);maxX=Math.max(maxX,p[0]);minY=Math.min(minY,p[1]);maxY=Math.max(maxY,p[1]);}
 return {points,segments,bounds:points.length?[[minX,minY],[maxX,maxY]]:[],lods:TRAIL_TOLERANCES.map(tolerance=>({tolerance,segments:runs.flatMap(run=>simplify(run,tolerance))}))};
}
export function displaySegments(trail,units){let result=trail.segments;for(const lod of trail.lods||[])if(lod.tolerance<=units*.35)result=lod.segments;return result;}
