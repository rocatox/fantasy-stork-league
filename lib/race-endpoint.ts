import {germanyPosition} from './geo';
import {refreshReplacements} from './replacements';
import {env} from 'cloudflare:workers';
import {database,json} from './store';
import {seasonWindow,reconcileResult,validArrival,RACE_VERSION} from './race.mjs';
import {syncPolicy} from './sync-policy.mjs';
import source from '../data/boundary-source.json';
import seed from '../data/seed.json';

async function targets(db:any,now:number){
 await refreshReplacements(now);
 const rows=await db.prepare("SELECT state FROM leagues WHERE json_extract(state,'$.status')='ready'").all();
 const targets=new Map<string,any>();
 for(const row of rows.results){const l=JSON.parse(row.state);if(!l.size||l.picks.length!==l.members.length*l.size||seasonWindow(l.year).start>now)continue;
  for(const p of l.picks){if(p.replacementRequired)continue;const study=seed.studies.find(s=>p.birdId.startsWith(s.studyId+':'));if(study)targets.set(l.year+':'+p.birdId,{birdId:p.birdId,year:l.year,study,individualId:p.individualId||null,name:p.birdId.slice(study.studyId.length+1)});}
 }
 return [...targets.values()];
}
export async function POST(req:Request){
 const secret=(env as any).SYNC_SECRET;if(!secret||req.headers.get('authorization')!==`Bearer ${secret}`)return json({error:'Unauthorized'},401);
 const raw=await req.text();if(raw.length>20000)return json({error:'Payload too large'},413);
 let input:any;try{input=JSON.parse(raw);}catch{return json({error:'Invalid JSON'},400);}
 const db=database(),now=Date.now();
 if(input.action==='queue'){
  const rows=await db.prepare('SELECT bird_id,year,payload FROM race_results').all();
  const states=new Map(rows.results.map((r:any)=>[r.year+':'+r.bird_id,JSON.parse(r.payload)]));
  return json({targets:(await targets(db,now)).map(t=>({...t,state:states.get(t.year+':'+t.birdId)||null})),boundaryVersion:source.version,version:RACE_VERSION});
 }
 if(typeof input.birdId!=='string'||!Number.isInteger(input.year)||input.year<2026||input.year>2100)return json({error:'Invalid race target'},400);
 const lockId='race-lock:'+input.year+':'+input.birdId;
 if(input.action==='claim'){
  const target=(await targets(db,now)).find(t=>t.birdId===input.birdId&&t.year===input.year);if(!target)return json({error:'Bird is not in an active completed draft'},400);
  await db.prepare("DELETE FROM sync_state WHERE id=? AND json_extract(payload,'$.expiresAt')<?").bind(lockId,now).run();
  const lease=crypto.randomUUID();const claim=await db.prepare('INSERT OR IGNORE INTO sync_state(id,payload) VALUES(?,?)').bind(lockId,JSON.stringify({lease,expiresAt:now+20*60000})).run();
  if(!claim.meta.changes)return json({error:'Race import in progress'},409);
  const previous=await db.prepare('SELECT payload FROM race_results WHERE bird_id=? AND year=?').bind(input.birdId,input.year).first();
  return json({lease,target,state:previous?JSON.parse(previous.payload):null});
 }
 const lock=await db.prepare('SELECT payload FROM sync_state WHERE id=?').bind(lockId).first(),owner=lock?JSON.parse(lock.payload):null;
 if(!owner||owner.lease!==input.lease||owner.expiresAt<now)return json({error:'Race lease expired'},409);
 if(input.action==='release'){await db.prepare("DELETE FROM sync_state WHERE id=? AND json_extract(payload,'$.lease')=?").bind(lockId,input.lease).run();return json({released:true});}
 const r=input.result,start=Date.parse(r?.startedAt);
 if(input.action!=='commit'||!r||r.boundaryVersion!==source.version||!Number.isFinite(start)||start>now||start<now-20*60000||!validArrival(r.arrival,input.year,now)||!Number.isInteger(r.eventRows)||r.eventRows<0||!Number.isInteger(r.validFixes)||r.validFixes<0||r.validFixes>r.eventRows||!Number.isInteger(r.boundaryFixes)||r.boundaryFixes<0||r.boundaryFixes>r.validFixes||typeof r.individualId!=='string'||!r.individualId||r.arrival&&r.validFixes===0)return json({error:'Invalid race result'},400);
 if(r.arrival&&(germanyPosition(r.arrival.longitude,r.arrival.latitude)!=='inside'||germanyPosition(r.arrival.confirmation.longitude,r.arrival.confirmation.latitude)!=='inside'))return json({error:'Unconfirmed German arrival'},400);
 const row=await db.prepare('SELECT payload FROM race_results WHERE bird_id=? AND year=?').bind(input.birdId,input.year).first(),prior=row?JSON.parse(row.payload):null;
 if(prior?.eventRows>0&&r.eventRows===0)return json({error:'Unexpected empty season export; previous result retained for review'},409);
 if(prior?.individualId&&prior.individualId!==r.individualId)return json({error:'Bird identity changed; review required'},409);
 const result=reconcileResult(prior,{birdId:input.birdId,year:input.year,individualId:r.individualId,arrival:r.arrival,eventRows:r.eventRows,validFixes:r.validFixes,boundaryFixes:r.boundaryFixes,boundaryVersion:source.version,startedAt:r.startedAt,slot:syncPolicy(start).slot},now);
 const guard="EXISTS (SELECT 1 FROM sync_state WHERE id=? AND json_extract(payload,'$.lease')=? AND json_extract(payload,'$.expiresAt')>=?)";
 const statements=[db.prepare(`INSERT INTO race_results(bird_id,year,payload) SELECT ?,?,? WHERE ${guard} ON CONFLICT(bird_id,year) DO UPDATE SET payload=excluded.payload`).bind(input.birdId,input.year,JSON.stringify(result),lockId,input.lease,now)];
 if(result.revision!==(prior?.revision||0))statements.push(db.prepare(`INSERT INTO race_audit(id,bird_id,year,previous_arrival,arrival,changed_at,boundary_version) SELECT ?,?,?,?,?,?,? WHERE ${guard}`).bind(crypto.randomUUID(),input.birdId,input.year,JSON.stringify(prior?.arrival||null),JSON.stringify(result.arrival),result.changedAt,source.version,lockId,input.lease,now));
 statements.push(db.prepare("DELETE FROM sync_state WHERE id=? AND json_extract(payload,'$.lease')=?").bind(lockId,input.lease));
 const committed=await db.batch(statements);if(!committed[0].meta.changes)return json({error:'Race result not committed'},409);
 return json({status:'succeeded',birdId:input.birdId,year:input.year,revision:result.revision,arrival:result.arrival,checkedAt:result.checkedAt});
}
