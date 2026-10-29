import {env} from 'cloudflare:workers';
import {database,getBirds,json} from './store';
import {cleanupBirds} from './bird-cleanup';
import {archiveCandidate} from './rules.mjs';
import seed from '../data/seed.json';
import {transportData,storageData} from './history-binary';
import {migrationSeasons,MIGRATION_STATS_VERSION} from './migration-stats.mjs';
import {standings} from './race.mjs';
const archiveDatabase=()=> (env as any).HISTORY_ARCHIVE||database();
const archiveStores=()=> (env as any).HISTORY_ARCHIVE?[database(),archiveDatabase()]:[database()];
async function archiveRow(birdId:string,month:string){for(const store of [...archiveStores()].reverse()){const row=await store.prepare('SELECT data FROM history_chunks WHERE bird_id=? AND month=?').bind(birdId,month).first();if(row)return {row,store};}return {row:null,store:archiveDatabase()};}

export async function GET(req:Request){
 const url=new URL(req.url),id=url.searchParams.get('bird'),year=url.searchParams.get('year'),timeline=url.searchParams.get('timeline')==='1';
 if(url.searchParams.get('rankings')==='1'){
  const birds=await getBirds(),ids=new Set(birds.map(b=>b.id));
  // Only small derived evidence is read; no archives or map coordinates are loaded.
  const sources=await Promise.all(archiveStores().map(store=>store.prepare("SELECT bird_id,month,json_object('version',json_extract(summary,'$.migration.version'),'first',json_extract(summary,'$.migration.first'),'inside',json_extract(summary,'$.migration.inside')) AS migration FROM history_chunks WHERE substr(month,6,2)<='06'").all()));
  const merged=new Map<string,Map<string,any>>();
  for(const source of sources)for(const row of source.results){if(!ids.has(row.bird_id))continue;if(!merged.has(row.bird_id))merged.set(row.bird_id,new Map());merged.get(row.bird_id)!.set(row.month,{month:row.month,migration:JSON.parse(row.migration)});}
  const rankings=Object.fromEntries(birds.map(b=>{const s=migrationSeasons([...(merged.get(b.id)?.values()||[])]);return [b.id,{successes:s.successes,attempts:s.attempts,pendingYears:s.pendingYears,typicalArrival:s.successes>1?s.typicalArrival:null}];}));
  return json({rankings});
 }

 if(!id||year&&!/^\d{4}$/.test(year))return json({error:'Invalid bird or year'},400);
 const db=database();
 if(!(await getBirds()).some(b=>b.id===id))return json({error:'Bird is no longer in the live roster'},404);
 const state=await db.prepare('SELECT payload FROM history_state WHERE bird_id=?').bind(id).first();
 // Metadata requests omit coordinates; replay loads bounded monthly previews across all years.
 const sources=await Promise.all(archiveStores().map(store=>store.prepare("SELECT month, CASE WHEN ?='all' OR substr(month,1,4)=? THEN summary ELSE json_remove(summary,'$.preview') END AS summary FROM history_chunks WHERE bird_id=? ORDER BY month").bind(timeline?'all':'year',year||'',id).all()));
 const merged=new Map<string,any>();for(const source of sources)for(const r of source.results)merged.set(r.month,{month:r.month,...JSON.parse(r.summary)});
 const months=[...merged.values()].sort((a,b)=>a.month.localeCompare(b.month));
 const selected=year?months.filter((m:any)=>m.month.startsWith(year)):months;
 return json({migration:migrationSeasons(months),state:state?JSON.parse(state.payload):null,years:[...new Set(months.map((m:any)=>m.month.slice(0,4)))],records:months.reduce((s:number,m:any)=>s+m.records,0),valid:months.reduce((s:number,m:any)=>s+m.valid,0),first:months.find((m:any)=>m.first)?.first||null,last:[...months].reverse().find((m:any)=>m.last)?.last||null,points:timeline?months.flatMap((m:any)=>m.preview||[]):year?selected.flatMap((m:any)=>m.preview):[],months:months.map(({preview,...m}:any)=>m)});
}

export async function POST(req:Request){
 const secret=(env as any).SYNC_SECRET;
 if(!secret||req.headers.get('authorization')!==`Bearer ${secret}`)return json({error:'Unauthorized'},401);
 const raw=await req.text();if(raw.length>1800000)return json({error:'Payload too large'},413);
 let input:any;try{input=JSON.parse(raw);}catch{return json({error:'Invalid JSON'},400);}
 const db=database(),archive=archiveDatabase(),now=Date.now();
 if(input.action==='retention'){
  const leagues=await db.prepare("SELECT state FROM leagues WHERE json_extract(state,'$.status')='ready'").all();
  const results=(await db.prepare('SELECT payload FROM race_results').all()).results.map((r:any)=>JSON.parse(r.payload));
  const evidence=(await db.prepare('SELECT bird_id,previous_arrival,arrival FROM race_audit').all()).results;
  const protections:any={};const entry=(id:string)=>protections[id]||(protections[id]={heldYears:[],pinnedIds:[]});
  for(const row of leagues.results){const league=JSON.parse(row.state);if(standings(league,results,now).status!=='complete')for(const p of league.picks)entry(p.birdId).heldYears.push(league.year);}
  for(const r of results)if(r.arrival)entry(r.birdId).pinnedIds.push(r.arrival.eventId,...(r.arrival.confirmation?[r.arrival.confirmation.eventId]:[]),...(r.arrival.before?[r.arrival.before.eventId]:[]));
  for(const r of evidence)for(const raw of [r.previous_arrival,r.arrival]){const a=raw?JSON.parse(raw):null;if(a)entry(r.bird_id).pinnedIds.push(a.eventId,...(a.confirmation?[a.confirmation.eventId]:[]),...(a.before?[a.before.eventId]:[]));}
  return json({now,protections});
 }
 if(input.action==='queue'){
  await cleanupBirds(now);
  const states=await db.prepare('SELECT bird_id,payload FROM history_state').all();
  const known=new Map(states.results.map((r:any)=>[r.bird_id,JSON.parse(r.payload)]));
  const birds=(await getBirds()).filter(b=>archiveCandidate(b,now)||known.has(b.id));
  const pending=birds.filter(b=>!known.has(b.id));
  if(pending.length)await db.batch(pending.map(b=>db.prepare('INSERT OR IGNORE INTO history_state(bird_id,payload) VALUES(?,?)').bind(b.id,JSON.stringify({version:1,complete:false,queuedAt:new Date(now).toISOString()}))));
  const metadata=await db.prepare("SELECT id,payload FROM sync_state WHERE id LIKE 'metadata:%'").all();
  return json({birds:birds.map(b=>({...b,archiveState:known.get(b.id)||null})),studies:seed.studies,metadata:Object.fromEntries(metadata.results.map((r:any)=>[r.id.slice(9),JSON.parse(r.payload)]))});
 }
 const birdId=input.birdId,study=seed.studies.find(s=>birdId?.startsWith(s.studyId+':'));
 if(!study)return json({error:'Unapproved study'},400);
 if(input.action==='claim'){
  const birds=await getBirds(),prior=await db.prepare('SELECT payload FROM history_state WHERE bird_id=?').bind(birdId).first();
  if(!birds.some(b=>b.id===birdId&&(prior||archiveCandidate(b,now))))return json({error:'Bird does not qualify for its first research backfill'},400);
  if(input.lease!==undefined&&!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(input.lease))return json({error:'Invalid claim identifier'},400);
  const lease=input.lease||crypto.randomUUID(),id='history-lock:'+birdId;
  await db.prepare("DELETE FROM sync_state WHERE id=? AND json_extract(payload,'$.expiresAt')<?").bind(id,now).run();
  const result=await db.prepare('INSERT OR IGNORE INTO sync_state(id,payload) VALUES(?,?)').bind(id,JSON.stringify({lease,expiresAt:now+20*60000})).run();
  if(!result.meta.changes){
   const existing=await db.prepare('SELECT payload FROM sync_state WHERE id=?').bind(id).first();
   if(!existing||JSON.parse(existing.payload).lease!==lease)return json({error:'History is already running'},409);
  }
  if(!prior)await db.prepare('INSERT OR IGNORE INTO history_state(bird_id,payload) VALUES(?,?)').bind(birdId,JSON.stringify({version:1,complete:false,queuedAt:new Date(now).toISOString()})).run();
  const existing=await Promise.all(archiveStores().map(store=>store.prepare('SELECT month,summary FROM history_chunks WHERE bird_id=?').bind(birdId).all()));
  const summaries=Object.fromEntries(existing.flatMap(result=>result.results.map((r:any)=>[r.month,JSON.parse(r.summary)])));
  return json({lease,state:prior?JSON.parse(prior.payload):null,months:Object.keys(summaries),summaries,legacyMonths:archive!==db?existing[0].results.map((r:any)=>r.month):[]});
 }
 const lockId='history-lock:'+birdId;
 const lock=await db.prepare('SELECT payload FROM sync_state WHERE id=?').bind(lockId).first();
 const owner=lock?JSON.parse(lock.payload):null;
 if(!owner||owner.lease!==input.lease||owner.expiresAt<now)return json({error:'Invalid history lease'},409);
 if(input.action==='migrationSummary'){
  if(!/^\d{4}-\d{2}$/.test(input.month)||input.migration?.version!==MIGRATION_STATS_VERSION||!Number.isInteger(input.migration.valid)||input.migration.valid<0)return json({error:'Invalid migration summary'},400);
  const {store}=await archiveRow(birdId,input.month);
  const row=await store.prepare('SELECT summary FROM history_chunks WHERE bird_id=? AND month=?').bind(birdId,input.month).first();
  if(!row||row.summary!==input.expectedSummary)return json({error:'Archive changed; rescan required'},409);
  const summary={...JSON.parse(row.summary),migration:input.migration};
  await store.prepare('UPDATE history_chunks SET summary=? WHERE bird_id=? AND month=? AND summary=?').bind(JSON.stringify(summary),birdId,input.month,row.summary).run();
  await db.prepare('UPDATE sync_state SET payload=? WHERE id=?').bind(JSON.stringify({...owner,expiresAt:now+20*60000}),lockId).run();
  return json({stored:true});
 }
 if(input.action==='pruneLegacy'){
  if(archive===db)return json({removed:false});
  const newer=await archive.prepare('SELECT summary FROM history_chunks WHERE bird_id=? AND month=?').bind(birdId,input.month).first();
  if(!newer||newer.summary!==JSON.stringify(input.verifiedSummary))return json({error:'Verified replacement changed'},409);
  await db.batch([db.prepare('DELETE FROM history_parts WHERE bird_id=? AND month=?').bind(birdId,input.month),db.prepare('DELETE FROM history_chunks WHERE bird_id=? AND month=?').bind(birdId,input.month)]);
  return json({removed:true});
 }
 if(input.action==='read'){
  const {row,store}=await archiveRow(birdId,input.month);
  if(typeof row?.data==='string'&&row.data.startsWith('parts:')){
   const [,generation,count]=row.data.split(':');
   if(input.manifest)return json({parts:{generation,count:Number(count)}});
   const pieces=await store.prepare('SELECT data FROM history_parts WHERE bird_id=? AND month=? AND generation=? ORDER BY part').bind(birdId,input.month,generation).all();
   if(pieces.results.length!==Number(count))return json({error:'Incomplete stored archive'},503);
   return json({data:pieces.results.map((p:any)=>transportData(p.data)).join('')});
  }
  return json({data:row?transportData(row.data):null});
 }
 if(input.action==='readPart'){
  if(!Number.isInteger(input.part)||input.part<0||input.part>999)return json({error:'Invalid archive part'},400);
  for(const store of [...archiveStores()].reverse()){const row=await store.prepare('SELECT data FROM history_parts WHERE bird_id=? AND month=? AND generation=? AND part=?').bind(birdId,input.month,input.generation,input.part).first();if(row)return json({data:transportData(row.data)});}
  return json({error:'Archive part missing'},404);
 }
 if(input.action==='part'){
  if(!/^\d{4}-\d{2}$/.test(input.month)||!Number.isInteger(input.part)||input.part<0||input.part>999||typeof input.data!=='string'||input.data.length>500000)return json({error:'Invalid archive part'},400);
  await archive.prepare('INSERT INTO history_parts(bird_id,month,generation,part,data) VALUES(?,?,?,?,?) ON CONFLICT(bird_id,month,generation,part) DO UPDATE SET data=excluded.data').bind(birdId,input.month,input.lease,input.part,storageData(input.data,input.binary===true)).run();
  await db.prepare('UPDATE sync_state SET payload=? WHERE id=?').bind(JSON.stringify({...owner,expiresAt:now+20*60000}),lockId).run();return json({stored:true});
 }
 if(input.action==='chunk'||input.action==='chunks'){
  const chunks=input.action==='chunk'?[input]:input.chunks;
  if(!Array.isArray(chunks)||!chunks.length||chunks.length>8||new Set(chunks.map((c:any)=>c.month)).size!==chunks.length)return json({error:'Invalid archive batch'},400);
  const writes:any[]=[];
  for(const chunk of chunks){
   const s=chunk.summary;
   if(!/^\d{4}-\d{2}$/.test(chunk.month)||typeof chunk.data!=='string'||chunk.data.length>1600000||!s||!Number.isInteger(s.records)||s.records<0||!Number.isInteger(s.valid)||s.valid<0||s.valid>s.records||!Array.isArray(s.preview)||s.preview.length>121)return json({error:'Invalid history chunk'},400);
   let generation='';
   if(chunk.data.startsWith('parts:')){
    const [,key,count]=chunk.data.split(':');generation=key;
    if(key!==input.lease||!/^\d+$/.test(count)||Number(count)<1||Number(count)>1000)return json({error:'Invalid multipart archive'},400);
    const parts=await archive.prepare('SELECT COUNT(*) AS count,MIN(part) AS first,MAX(part) AS last FROM history_parts WHERE bird_id=? AND month=? AND generation=?').bind(birdId,chunk.month,key).first();
    if(parts.count!==Number(count)||parts.first!==0||parts.last!==Number(count)-1)return json({error:'Archive upload incomplete'},400);
   }
   writes.push(archive.prepare('INSERT INTO history_chunks(bird_id,month,data,summary) VALUES(?,?,?,?) ON CONFLICT(bird_id,month) DO UPDATE SET data=excluded.data,summary=excluded.summary').bind(birdId,chunk.month,storageData(chunk.data,chunk.binary===true&&!generation),JSON.stringify(s)));
   writes.push(archive.prepare('DELETE FROM history_parts WHERE bird_id=? AND month=? AND generation<>?').bind(birdId,chunk.month,generation));
  }
  await archive.batch(writes);
  // Sparse corroboration can span months: invalidate the affected season, including December context.
  for(const store of archiveStores())for(const chunk of chunks)await store.prepare("UPDATE history_chunks SET summary=json_remove(summary,'$.migration') WHERE bird_id=? AND substr(month,6,2)<='06' AND ((substr(?,6,2)<='07' AND substr(month,1,4)=substr(?,1,4)) OR (substr(?,6,2)='12' AND substr(month,1,4)=strftime('%Y',?,'+1 month')))").bind(birdId,chunk.month,chunk.month,chunk.month,chunk.month+'-01').run();
  await db.prepare('UPDATE sync_state SET payload=? WHERE id=?').bind(JSON.stringify({...owner,expiresAt:now+20*60000}),lockId).run();return json({stored:true});
 }
 if(input.action==='complete'){
  if(!Number.isFinite(Date.parse(input.startedAt))||Date.parse(input.startedAt)>now)return json({error:'Invalid cursor'},400);
  const state={version:1,complete:true,lastSuccessAt:new Date(now).toISOString(),cursor:input.startedAt,slot:input.slot,individualId:input.individualId,sourceUrl:study.sourceUrl,license:study.license};
  await db.prepare('INSERT INTO history_state(bird_id,payload) VALUES(?,?) ON CONFLICT(bird_id) DO UPDATE SET payload=excluded.payload').bind(birdId,JSON.stringify(state)).run();
 }
 if(input.action==='complete'||input.action==='release'){
  await db.prepare('DELETE FROM sync_state WHERE id=?').bind(lockId).run();return json({ok:true});
 }
 return json({error:'Unknown history action'},400);
}
