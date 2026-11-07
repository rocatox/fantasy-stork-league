import {historyRows} from './history-shards';
import {savedRankings} from './rankings';
import {database,json} from './store';
import {keepBird} from './bird-lifecycle.mjs';
import {historyResponse} from './history-response.mjs';
import {migrationSeasons} from './migration-stats.mjs';

export async function GET(req:Request){
 const url=new URL(req.url),id=url.searchParams.get('bird'),year=url.searchParams.get('year'),timeline=url.searchParams.get('timeline')==='1';
 if(url.searchParams.get('rankings')==='1')return json({rankings:await savedRankings()});

 if(!id||year&&!/^\d{4}$/.test(year))return json({error:'Invalid bird or year'},400);
 const db=database();
 // A history read needs only this bird's lifecycle fields, not the full roster/GPS payloads.
 const bird=await db.prepare("SELECT json_extract(payload,'$.latestValidFixUtc') AS latestValidFixUtc,json_extract(payload,'$.recordedDead') AS recordedDead FROM birds WHERE id=?").bind(id).first();
 if(!bird||!keepBird(bird))return json({error:'Bird is no longer in the live roster'},404);
 // Map overviews need only the recent window, plus a month of quality-screening context.
 if(url.searchParams.has('start')||url.searchParams.has('end')){
  const start=Number(url.searchParams.get('start')),end=Number(url.searchParams.get('end'));
  if(!url.searchParams.has('start')||!url.searchParams.has('end')||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<start||end-start>370*86400000||end>Date.now()+86400000)return json({error:'Invalid history window'},400);
  const from=new Date(start-31*86400000).toISOString().slice(0,7),to=new Date(end+31*86400000).toISOString().slice(0,7);
  const rows=await historyRows(id,"json_extract(summary,'$.preview') AS preview","AND month>=? AND month<=?",[from,to]);
  return historyResponse({},rows.map(r=>r.preview));
 }
 const state=await db.prepare('SELECT payload FROM history_state WHERE bird_id=?').bind(id).first();
 // Metadata requests omit coordinates; replay loads bounded monthly previews across all years.
 const preview=timeline?"json_extract(summary,'$.preview')":year?"CASE WHEN substr(month,1,4)='"+year+"' THEN json_extract(summary,'$.preview') ELSE NULL END":"NULL";
 const rows=await historyRows(id,"json_remove(summary,'$.preview') AS summary,"+preview+' AS preview');
 const months=rows.map((r:any)=>({month:r.month,...JSON.parse(r.summary)}));
 return historyResponse({migration:migrationSeasons(months),state:state?JSON.parse(state.payload):null,years:[...new Set(months.map((m:any)=>m.month.slice(0,4)))],records:months.reduce((s:number,m:any)=>s+m.records,0),valid:months.reduce((s:number,m:any)=>s+m.valid,0),first:months.find((m:any)=>m.first)?.first||null,last:[...months].reverse().find((m:any)=>m.last)?.last||null,months},rows.map(r=>r.preview));
}

