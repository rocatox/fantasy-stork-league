import {env} from 'cloudflare:workers';
import {database,getBirds,json} from './store';
import {eligible} from './rules.mjs';
import seed from '../data/seed.json';

export async function GET(req:Request){
 const url=new URL(req.url),id=url.searchParams.get('bird'),year=url.searchParams.get('year');
 if(!id||year&&!/^\d{4}$/.test(year))return json({error:'Invalid bird or year'},400);
 const db=database();
 const state=await db.prepare('SELECT payload FROM history_state WHERE bird_id=?').bind(id).first();
 const rows=await db.prepare('SELECT month,summary FROM history_chunks WHERE bird_id=? ORDER BY month').bind(id).all();
 const months=rows.results.map((r:any)=>({month:r.month,...JSON.parse(r.summary)}));
 const selected=year?months.filter((m:any)=>m.month.startsWith(year)):months;
 return json({state:state?JSON.parse(state.payload):null,years:[...new Set(months.map((m:any)=>m.month.slice(0,4)))],records:months.reduce((s:number,m:any)=>s+m.records,0),valid:months.reduce((s:number,m:any)=>s+m.valid,0),first:months.find((m:any)=>m.first)?.first||null,last:[...months].reverse().find((m:any)=>m.last)?.last||null,points:year?selected.flatMap((m:any)=>m.preview):[],months:months.map(({preview,...m}:any)=>m)});
}

export async function POST(req:Request){
 const secret=(env as any).SYNC_SECRET;
 if(!secret||req.headers.get('authorization')!==`Bearer ${secret}`)return json({error:'Unauthorized'},401);
 const raw=await req.text();if(raw.length>1800000)return json({error:'Payload too large'},413);
 let input:any;try{input=JSON.parse(raw);}catch{return json({error:'Invalid JSON'},400);}
 const db=database(),now=Date.now();
 if(input.action==='queue'){
  const states=await db.prepare('SELECT bird_id,payload FROM history_state').all();
  const known=new Map(states.results.map((r:any)=>[r.bird_id,JSON.parse(r.payload)]));
  const birds=(await getBirds()).filter(b=>eligible(b,now)||known.has(b.id));
  const pending=birds.filter(b=>!known.has(b.id));
  if(pending.length)await db.batch(pending.map(b=>db.prepare('INSERT OR IGNORE INTO history_state(bird_id,payload) VALUES(?,?)').bind(b.id,JSON.stringify({version:1,complete:false,queuedAt:new Date(now).toISOString()}))));
  const metadata=await db.prepare("SELECT id,payload FROM sync_state WHERE id LIKE 'metadata:%'").all();
  return json({birds:birds.map(b=>({...b,archiveState:known.get(b.id)||null})),studies:seed.studies,metadata:Object.fromEntries(metadata.results.map((r:any)=>[r.id.slice(9),JSON.parse(r.payload)]))});
 }
 const birdId=input.birdId,study=seed.studies.find(s=>birdId?.startsWith(s.studyId+':'));
 if(!study)return json({error:'Unapproved study'},400);
 if(input.action==='claim'){
  const birds=await getBirds(),prior=await db.prepare('SELECT payload FROM history_state WHERE bird_id=?').bind(birdId).first();
  if(!prior&&!birds.some(b=>b.id===birdId&&eligible(b,now)))return json({error:'Bird is not eligible for its first backfill'},400);
  const lease=crypto.randomUUID(),id='history-lock:'+birdId;
  await db.prepare("DELETE FROM sync_state WHERE id=? AND json_extract(payload,'$.expiresAt')<?").bind(id,now).run();
  const result=await db.prepare('INSERT OR IGNORE INTO sync_state(id,payload) VALUES(?,?)').bind(id,JSON.stringify({lease,expiresAt:now+20*60000})).run();
  if(!result.meta.changes)return json({error:'History is already running'},409);
  if(!prior)await db.prepare('INSERT OR IGNORE INTO history_state(bird_id,payload) VALUES(?,?)').bind(birdId,JSON.stringify({version:1,complete:false,queuedAt:new Date(now).toISOString()})).run();
  return json({lease,state:prior?JSON.parse(prior.payload):null});
 }
 const lockId='history-lock:'+birdId;
 const lock=await db.prepare('SELECT payload FROM sync_state WHERE id=?').bind(lockId).first();
 const owner=lock?JSON.parse(lock.payload):null;
 if(!owner||owner.lease!==input.lease||owner.expiresAt<now)return json({error:'Invalid history lease'},409);
 if(input.action==='read'){
  const row=await db.prepare('SELECT data FROM history_chunks WHERE bird_id=? AND month=?').bind(birdId,input.month).first();return json({data:row?.data||null});
 }
 if(input.action==='chunk'){
  const s=input.summary;
  if(!/^\d{4}-\d{2}$/.test(input.month)||typeof input.data!=='string'||input.data.length>1600000||!s||!Number.isInteger(s.records)||s.records<1||!Number.isInteger(s.valid)||s.valid<0||s.valid>s.records||!Array.isArray(s.preview)||s.preview.length>121)return json({error:'Invalid history chunk'},400);
  await db.batch([
   db.prepare('INSERT INTO history_chunks(bird_id,month,data,summary) VALUES(?,?,?,?) ON CONFLICT(bird_id,month) DO UPDATE SET data=excluded.data,summary=excluded.summary').bind(birdId,input.month,input.data,JSON.stringify(s)),
   db.prepare('UPDATE sync_state SET payload=? WHERE id=?').bind(JSON.stringify({...owner,expiresAt:now+20*60000}),lockId)
  ]);return json({stored:true});
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
