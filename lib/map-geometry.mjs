export const WORLD=1024,MAX_LAT=85.0511287798066;
export function mercator([lon,lat]){
 const phi=Math.max(-MAX_LAT,Math.min(MAX_LAT,lat))*Math.PI/180;
 return [(lon+180)/360*WORLD,(1-Math.log(Math.tan(Math.PI/4+phi/2))/Math.PI)/2*WORLD];
}
export function fitCamera(points,width,height){
 const xy=points.map(mercator),xs=xy.map(p=>p[0]),ys=xy.map(p=>p[1]);
 const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
 return {x:(minX+maxX)/2,y:(minY+maxY)/2,units:Math.max((maxX-minX)/Math.max(100,width-70),(maxY-minY)/Math.max(100,height-70),.015)};
}
export function trackPoints(points){
 const seen=new Set();return points.filter(p=>Array.isArray(p)&&Number.isFinite(p[0])&&Math.abs(p[0])<=180&&Number.isFinite(p[1])&&Math.abs(p[1])<=90&&Number.isFinite(Date.parse(p[2])))
 .sort((a,b)=>Date.parse(a[2])-Date.parse(b[2])).filter(p=>{const key=p.join('|');if(seen.has(key))return false;seen.add(key);return true;});
}
export function observationIndex(points,time){
 if(!points.length)return -1;let lo=0,hi=points.length;
 while(lo<hi){const mid=(lo+hi)>>1;if(Date.parse(points[mid][2])<=time)lo=mid+1;else hi=mid;}
 return Math.max(0,lo-1);
}
// Long gaps and antimeridian crossings are not drawn as known flight routes.
export function trailPath(points){return points.map((p,i)=>{const xy=mercator(p),prev=points[i-1];return `${!prev||Date.parse(p[2])-Date.parse(prev[2])>7*86400000||Math.abs(p[0]-prev[0])>180?'M':'L'}${xy[0]},${xy[1]}`;}).join(' ');}

// Visual interpolation only; do not bridge gaps or antimeridian discontinuities.
export function replayPosition(points,time){
 const index=observationIndex(points,time);if(index<0)return null;
 const a=points[index],b=points[index+1],start=Date.parse(a[2]),end=b?Date.parse(b[2]):start;
 const gap=!!b&&(end-start>7*86400000||Math.abs(b[0]-a[0])>180);
 const fraction=b&&!gap&&end>start?Math.max(0,Math.min(1,(time-start)/(end-start))):0;
 const xy=mercator(a),next=b?mercator(b):xy;
 const x=xy[0]+(next[0]-xy[0])*fraction,y=xy[1]+(next[1]-xy[1])*fraction;
 return {index,canInterpolate:!!b&&!gap,xy:[x,y],longitude:x/WORLD*360-180,latitude:Math.atan(Math.sinh(Math.PI*(1-2*y/WORLD)))*180/Math.PI,estimated:fraction>0&&fraction<1,gap:gap&&time>start,observedAt:a[2],nextAt:b?.[2]||null};
}

// Paint each valid leg independently so overlapping journeys accumulate opacity.
export function trailSegments(points){
 const segments=[];
 for(let index=0;index<points.length-1;index++){
  const a=points[index],b=points[index+1];
  if(Date.parse(b[2])-Date.parse(a[2])>7*86400000||Math.abs(b[0]-a[0])>180)continue;
  segments.push({index,path:`M${mercator(a).join(',')} L${mercator(b).join(',')}`});
 }
 return segments;
}
