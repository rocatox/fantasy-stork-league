import {syncPolicy,easternParts} from './sync-policy.mjs';
import {trackPoints,replayPosition} from './map-geometry.mjs';
export function leagueWindow(now){
 const rolling=now-30*86400000;
 const start=syncPolicy(now).racing?Math.min(rolling,Date.parse(`${easternParts(now).year}-01-16T05:00:00Z`)):rolling;
 return {start,end:now};
}
export function windowPoints(history,start,end){
 const clean=trackPoints(history),result=clean.filter(p=>Date.parse(p[2])>=start&&Date.parse(p[2])<=end);
 // Clip valid crossing legs exactly at the window edge; never bridge tracking gaps.
 for(const edge of [start,end]){
  const p=replayPosition(clean,edge);
  if(p?.estimated&&Date.parse(p.observedAt)<edge&&Date.parse(p.nextAt)>edge)result.push([p.longitude,p.latitude,new Date(edge).toISOString()]);
 }
 return result.sort((a,b)=>Date.parse(a[2])-Date.parse(b[2]));
}
export function trailOpacity(stamp,start,end){return Math.max(0,Math.min(1,(stamp-start)/Math.max(1,end-start)));}
