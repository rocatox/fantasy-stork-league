import {timestamp} from './feed.mjs';

// Keep source records, including source-marked outliers. Only valid fixes enter previews.
export function historyRecord(e, now=Date.now()) {
 const t=timestamp(e.timestamp);
 if(!Number.isFinite(t)||t>now||e.individual_taxon_canonical_name!=='Ciconia ciconia')return null;
 const lon=Number(e.location_long),lat=Number(e.location_lat);
 const valid=e.visible==='true'&&e.location_long!==''&&e.location_lat!==''&&Number.isFinite(lon)&&Number.isFinite(lat)&&Math.abs(lon)<=180&&Math.abs(lat)<=90;
 return [new Date(t).toISOString(),e.event_id||e.id||`${e.tag_local_identifier}:${t}`,e.location_long,e.location_lat,e.tag_local_identifier,e.visible,valid];
}
export function mergeRecords(previous,incoming){
 const rows=new Map(previous.map(r=>[r[1],r]));
 for(const r of incoming)rows.set(r[1],r);
 return [...rows.values()].sort((a,b)=>a[0].localeCompare(b[0])||a[1].localeCompare(b[1]));
}
export function summarizeRecords(rows){
 const good=rows.filter(r=>r[6]);
 const step=Math.max(1,Math.ceil(good.length/120));
 const preview=good.filter((r,i)=>i%step===0||i===good.length-1).map(r=>[Number(r[2]),Number(r[3]),r[0]]);
 return {records:rows.length,valid:good.length,first:good[0]?.[0]||null,last:good.at(-1)?.[0]||null,preview};
}
