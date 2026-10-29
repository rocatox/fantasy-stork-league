import {screenPoints,confirmedInside} from './gps-quality.mjs';
export const MIGRATION_STATS_VERSION=2;
// Use retained source fixes with adjacent-month context, never map previews.
export function migrationMonth(rows,classify,boundaryVersion,context=[]){
 const all=[...context,...rows].filter(r=>r[6]).map(r=>[Number(r[2]),Number(r[3]),r[0],r]);
 const own=new Set(rows),{clean,suspect}=screenPoints(all);let first=null,last=null,valid=0;
 for(const p of clean){if(suspect.has(p)||!own.has(p[3]))continue;const position=classify(p[0],p[1]);if(position==='boundary')continue;
  const fix={at:p[2],longitude:p[0],latitude:p[1],position};valid++;if(!first)first=fix;last=fix;
 }
 const arrival=confirmedInside(all,classify,p=>p[3][4],p=>own.has(p[3]));
 const inside=arrival?{at:arrival.point[2],longitude:arrival.point[0],latitude:arrival.point[1],position:'inside',confirmedAt:arrival.confirmation[2]}:null;
 return {version:MIGRATION_STATS_VERSION,boundaryVersion,valid,first,last,inside};
}
export function migrationSeasons(months,now=Date.now()){
 const groups=new Map();
 for(const m of months){if(Number(m.month.slice(5,7))>6)continue;const year=m.month.slice(0,4);if(!groups.has(year))groups.set(year,[]);groups.get(year).push(m);}
 const seasons=[];let pending=0;
 for(const [year,group] of [...groups].sort((a,b)=>a[0].localeCompare(b[0]))){
  if(group.some(m=>m.migration?.version!==MIGRATION_STATS_VERSION)){pending++;continue;}
  const summaries=group.map(m=>m.migration),first=summaries.map(s=>s.first).filter(Boolean).sort((a,b)=>a.at.localeCompare(b.at))[0];
  if(!first)continue;
  if(first.position!=='outside'){seasons.push({year:Number(year),attempt:false,status:'first-seen-inside'});continue;}
  const arrival=summaries.map(s=>s.inside).filter(f=>f&&f.at>first.at).sort((a,b)=>a.at.localeCompare(b.at))[0]||null;
  seasons.push({year:Number(year),attempt:true,firstOutside:first.at,arrival:arrival?.at||null,status:arrival?'confirmed':now<Date.parse(year+'-07-01T00:00:00Z')?'ongoing':'not-confirmed',sampled:group.some(m=>m.sampled)});
 }
 const attempts=seasons.filter(s=>s.attempt),arrivals=attempts.filter(s=>s.arrival);
 const dates=arrivals.map(s=>Date.parse('2000-'+s.arrival.slice(5,10)+'T12:00:00Z')).sort((a,b)=>a-b);
 const median=dates.length?new Date(dates[Math.floor((dates.length-1)/2)]).toISOString().slice(5,10):null;
 return {seasons,attempts:attempts.length,successes:arrivals.length,pendingYears:pending,typicalArrival:median,method:'First valid non-boundary fix outside Germany in January–June; later quality-screened fix inside Germany corroborated by another inside fix 5 minutes to 48 hours later. Dates are UTC first retained inside fixes, not interpolated crossing times.'};
}
