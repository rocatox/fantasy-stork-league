import {env} from 'cloudflare:workers';
import {database,getBirds,json} from './store';
import {disbandExpired} from './disband';
import {validateSnapshot} from './snapshot.mjs';
import seed from '../data/seed.json';
export async function POST(req:Request){
 const secret=(env as any).SYNC_SECRET;if(!secret||req.headers.get('authorization')!==`Bearer ${secret}`)return json({error:'Unauthorized'},401);
 const raw=await req.text();if(raw.length>2000000)return json({error:'Payload too large'},413);
 let input:any;try{input=JSON.parse(raw);}catch{return json({error:'Invalid JSON'},400);}
 const study=seed.studies.find(s=>s.studyId===input.studyId);if(!study)return json({error:'Study is not approved'},400);
 const db=database(),now=Date.now(),lockId='external-sync-lock';
 if(input.action==='context'){
  await disbandExpired(now);
  await db.prepare("DELETE FROM sync_state WHERE id=? AND json_extract(payload,'$.expiresAt')<?").bind(lockId,now).run();
  const lease=crypto.randomUUID();const claim=await db.prepare('INSERT OR IGNORE INTO sync_state(id,payload) VALUES(?,?)').bind(lockId,JSON.stringify({lease,studyId:study.studyId,expiresAt:now+20*60000})).run();
  if(!claim.meta.changes)return json({error:'Sync already running'},409);
  const rows=await db.prepare('SELECT id,payload FROM sync_state WHERE id IN (?,?)').bind('study:'+study.studyId,'metadata:'+study.studyId).all();
  const state=rows.results.find((r:any)=>r.id==='study:'+study.studyId),metadata=rows.results.find((r:any)=>r.id==='metadata:'+study.studyId);
  return json({lease,study,current:await getBirds(),state:state?JSON.parse(state.payload):null,metadata:metadata?JSON.parse(metadata.payload):null});
 }
 const lock=await db.prepare('SELECT payload FROM sync_state WHERE id=?').bind(lockId).first();const owner=lock?JSON.parse(lock.payload):null;
 if(!owner||owner.lease!==input.lease||owner.studyId!==study.studyId||owner.expiresAt<now)return json({error:'Sync lease expired or invalid'},409);
 if(input.action==='release'){
  await db.prepare("DELETE FROM sync_state WHERE id=? AND json_extract(payload,'$.lease')=?").bind(lockId,input.lease).run();return json({released:true});
 }
 if(input.action!=='commit'||!validateSnapshot(input,now))return json({error:'Invalid snapshot'},400);
 const guard="EXISTS (SELECT 1 FROM sync_state WHERE id='external-sync-lock' AND json_extract(payload,'$.lease')=?)";
 const rows=[db.prepare(`INSERT INTO birds(id,payload) SELECT json_extract(value,'$.id'),value FROM json_each(?) WHERE ${guard} ON CONFLICT(id) DO UPDATE SET payload=excluded.payload`).bind(JSON.stringify(input.birds),input.lease)];
 for(const [id,value] of [['metadata:'+study.studyId,input.metadata],['study:'+study.studyId,input.state]])rows.push(db.prepare(`INSERT INTO sync_state(id,payload) SELECT ?,? WHERE ${guard} ON CONFLICT(id) DO UPDATE SET payload=excluded.payload`).bind(id,JSON.stringify(value),input.lease));
 rows.push(db.prepare(`INSERT INTO sync_runs(id,payload) SELECT ?,? WHERE ${guard} ON CONFLICT(id) DO NOTHING`).bind(input.state.lastSuccessAt+':'+study.studyId,JSON.stringify(input.report),input.lease));
 rows.push(db.prepare("DELETE FROM sync_state WHERE id=? AND json_extract(payload,'$.lease')=?").bind(lockId,input.lease));
 const results=await db.batch(rows);if(!results[2].meta.changes)return json({error:'Snapshot was not committed'},409);
 await db.prepare('DELETE FROM sync_runs WHERE id<?').bind(new Date(now-90*86400000).toISOString()).run();
 return json({status:'succeeded',studyId:study.studyId,updated:input.birds.length,lastSuccessAt:input.state.lastSuccessAt});
}
