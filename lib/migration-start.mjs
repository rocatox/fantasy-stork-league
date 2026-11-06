import {distanceKm,screenPoints} from './gps-quality.mjs';
export const MIGRATION_START_VERSION=2;
const DAY=86400000,GERMANY=[10.45,51.16];
// A conservative online signal, not a biological departure date. Paired daily
// anchors also accommodate solar tags that do not report during the night.
export function migrationStart(points,{start,end,now=Date.now()}={}){
 const valid=points.filter(p=>Number.isFinite(p[0])&&Math.abs(p[0])<=180&&Number.isFinite(p[1])&&Math.abs(p[1])<=90&&Number.isFinite(Date.parse(p[2]))&&Date.parse(p[2])<=now);
 const {clean,suspect}=screenPoints(valid),days=new Map();
 for(const p of clean){if(suspect.has(p))continue;const solar=Date.parse(p[2])+p[0]*240000;
  const day=Math.floor(solar/DAY);if(!days.has(day))days.set(day,[]);days.get(day).push(p);
 }
 const anchors=[];
 for(const [day,rows] of days){
  // First corroborated daily location: two fixes >=30 minutes apart within 20 km.
  let found=false;
  for(let i=0;i<rows.length&&!found;i++)for(let j=i+1;j<rows.length;j++){
   const a=rows[i],b=rows[j],dt=Date.parse(b[2])-Date.parse(a[2]);
   if(dt<1800000)continue;if(dt>6*3600000)break;
   if(a[3]?.tagId===b[3]?.tagId&&distanceKm(a,b)<=20){anchors.push({day,p:a,pair:[a,b]});found=true;break;}
  }
 }
 let earliest=null;
 // Three substantial travel days in at most five days; stopovers are observations, not gaps.
 for(let i=4;i+4<anchors.length;i++)for(let steps=3;steps<=5;steps++){
  if(i+steps+1>=anchors.length)continue;
  const group=anchors.slice(i-4,i+steps+2),base=anchors[i].p,travel=anchors.slice(i,i+steps+2);
  if(group.some((a,j)=>j&&a.day!==group[j-1].day+1)||group.some(a=>a.p[3]?.tagId!==base[3]?.tagId))continue;
  if(group.some((a,j)=>j&&Math.abs(Date.parse(a.p[2])-Date.parse(group[j-1].p[2])-DAY)>8*3600000))continue;
  if(Date.parse(travel[1].p[2])<start||Date.parse(travel.at(-1).pair[1][2])>=end)continue;
  if(group.slice(0,5).some(a=>distanceKm(a.p,base)>50))continue;
  const legs=travel.slice(1,-1).map((a,j)=>distanceKm(travel[j].p,a.p)),net=distanceKm(base,travel.at(-2).p);
  if(legs.filter(km=>km>=60).length<3||net<300||net/legs.reduce((a,b)=>a+b,0)<.7)continue;
  const progress=distanceKm(base,GERMANY)-distanceKm(travel.at(-2).p,GERMANY);
  // Keep a further night's corroboration: don't alert on an immediate return.
  if(progress<150||distanceKm(base,travel.at(-1).p)<300||distanceKm(base,GERMANY)-distanceKm(travel.at(-1).p,GERMANY)<150)continue;
  const detected={version:MIGRATION_START_VERSION,observedAt:travel[1].p[2],confirmedAt:travel.at(-1).pair[1][2],evidence:group.flatMap(a=>a.pair.map(p=>({longitude:p[0],latitude:p[1],observedAt:p[2],tagId:p[3]?.tagId||'',eventId:p[3]?.eventId||p[2]})))};
  if(!earliest||detected.confirmedAt<earliest.confirmedAt)earliest=detected;
 }
 return earliest;
}
// Recheck bounded evidence at the write boundary; raw tracks stay in the runner.
export function validMigrationStart(value,window,now=Date.now()){
 if(value===null)return true;
 if(value?.version!==MIGRATION_START_VERSION||!Array.isArray(value.evidence)||![18,20,22].includes(value.evidence.length))return false;
 if(value.evidence.some(f=>!f||typeof f.tagId!=='string'||!f.tagId||f.tagId.length>200||typeof f.eventId!=='string'||!f.eventId||f.eventId.length>200)||new Set(value.evidence.map(f=>f.eventId)).size!==value.evidence.length)return false;
 const detected=migrationStart(value.evidence.map(f=>[f.longitude,f.latitude,f.observedAt,f]),{...window,now});
 return !!detected&&detected.observedAt===value.observedAt&&detected.confirmedAt===value.confirmedAt;
}
