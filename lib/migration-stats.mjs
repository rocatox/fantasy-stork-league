import {screenPoints,evidenceAt} from './gps-quality.mjs';
export const MIGRATION_STATS_VERSION=4;
// One quality pass across a season; monthly boundaries cannot truncate sparse evidence.
export function migrationMonths(monthRows,classify,boundaryVersion,context=[],interior=(lon,lat)=>false){
 const owners=new Map(),all=[],summaries={};
 for(const [month,rows] of Object.entries(monthRows)){
  summaries[month]={version:MIGRATION_STATS_VERSION,boundaryVersion,valid:0,first:null,last:null,inside:null};
  for(const r of rows){owners.set(r,month);if(r[6])all.push([Number(r[2]),Number(r[3]),r[0],r]);}
 }
 for(const r of context)if(r[6])all.push([Number(r[2]),Number(r[3]),r[0],r]);
 const {clean,suspect}=screenPoints(all);
 for(let i=0;i<clean.length;i++){const p=clean[i],month=owners.get(p[3]);if(month===undefined||suspect.has(p))continue;
  const s=summaries[month],position=classify(p[0],p[1]);if(position==='boundary')continue;
  const fix={at:p[2],longitude:p[0],latitude:p[1],position};s.valid++;if(!s.first)s.first=fix;s.last=fix;
  if(!s.inside&&position==='inside'){const e=evidenceAt(clean,i,suspect,classify,p=>p[3][4],interior);if(e)s.inside={...fix,confirmedAt:e.confirmation[2],support:e.support};}
 }
 return summaries;
}
export function migrationMonth(rows,classify,boundaryVersion,context=[],interior=(lon,lat)=>false){return migrationMonths({own:rows},classify,boundaryVersion,context,interior).own;}
export function migrationSeasons(months,now=Date.now()){
 const groups=new Map();
 for(const m of months){const year=m.month.slice(0,4);if(!groups.has(year))groups.set(year,[]);groups.get(year).push(m);}
 const seasons=[];let pending=0;
 for(const [year,group] of [...groups].sort((a,b)=>a[0].localeCompare(b[0]))){
  const spring=group.filter(m=>Number(m.month.slice(5,7))<=6);
  if(!spring.length)continue;
  if(spring.some(m=>m.migration?.version!==MIGRATION_STATS_VERSION)){pending++;continue;}
  const summaries=group.filter(m=>m.migration?.version===MIGRATION_STATS_VERSION).map(m=>m.migration),first=spring.map(m=>m.migration).map(s=>s.first).filter(Boolean).sort((a,b)=>a.at.localeCompare(b.at))[0];
  if(!first)continue;
  if(first.position!=='outside'){seasons.push({year:Number(year),attempt:false,status:'first-seen-inside'});continue;}
  const end=Date.parse(year+'-07-01T04:00:00Z');
  const inside=summaries.map(s=>s.inside).filter(f=>f&&f.at>first.at&&Date.parse(f.at)<=now).sort((a,b)=>a.at.localeCompare(b.at));
  const arrival=inside.find(f=>Date.parse(f.at)<end)||null;
  const lateArrival=arrival?null:inside.find(f=>Date.parse(f.at)>=end)||null;
  seasons.push({year:Number(year),attempt:true,firstOutside:first.at,arrival:arrival?.at||null,lateArrival:lateArrival?.at||null,status:arrival?'confirmed':lateArrival?'late-arrival':now<end?'ongoing':'not-confirmed',sampled:group.some(m=>m.sampled)});
 }
 const attempts=seasons.filter(s=>s.attempt),arrivals=attempts.filter(s=>s.arrival);
 const dates=attempts.filter(s=>s.arrival||s.lateArrival).map(s=>Date.parse('2000-'+(s.arrival||s.lateArrival).slice(5,10)+'T12:00:00Z')).sort((a,b)=>a-b);
 const median=dates.length?new Date(dates[Math.floor((dates.length-1)/2)]).toISOString().slice(5,10):null;
 // Compare calendar days in a common leap year; retain the existing lower-median date.
 const deviations=dates.map(d=>Math.abs(d-dates[Math.floor((dates.length-1)/2)])/86400000).sort((a,b)=>a-b);
 const arrivalSpreadDays=dates.length<2?null:(deviations[Math.floor((deviations.length-1)/2)]+deviations[Math.floor(deviations.length/2)])/2;
 return {arrivalSpreadDays,seasons,attempts:attempts.length,successes:arrivals.length,pendingYears:pending,typicalArrival:median,method:'First valid non-boundary fix outside Germany in January–June; later quality-screened fix inside Germany supported by a later consistent inside fix or plausible surrounding observations for a brief crossing. Dates are UTC first retained inside fixes, not interpolated crossing times.'};
}
