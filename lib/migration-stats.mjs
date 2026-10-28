export const MIGRATION_STATS_VERSION=1;
// Summaries use retained source fixes, never the sparse map preview.
export function migrationMonth(rows,classify,boundaryVersion){
 let first=null,inside=null,last=null,valid=0;
 for(const r of rows){if(!r[6])continue;const position=classify(Number(r[2]),Number(r[3]));if(position==='boundary')continue;
  const fix={at:r[0],longitude:Number(r[2]),latitude:Number(r[3]),position};
  valid++;if(!first||fix.at<first.at)first=fix;if(!last||fix.at>last.at)last=fix;
  if(position==='inside'&&(!inside||fix.at<inside.at))inside=fix;
 }
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
 return {seasons,attempts:attempts.length,successes:arrivals.length,pendingYears:pending,typicalArrival:median,method:'First valid non-boundary fix outside Germany in January–June; later valid fix inside Germany. Dates are UTC first retained inside fixes, not interpolated crossing times.'};
}
