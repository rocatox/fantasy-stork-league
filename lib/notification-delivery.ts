import {database} from './store';
import {standings} from './race.mjs';
import {cutoff,DAY} from './rules.mjs';
import {newNotificationAccount,reconcileNotifications} from './notifications.mjs';
import {disbandExpired} from './disband';

// One source event per invocation: <=8 recipients, comfortably below Free D1's 50-query limit.
// Source triggers commit the queue entry atomically with the league/race write.
export async function deliverNotificationEvent(now=Date.now()){
 const db=database(),token=crypto.randomUUID();
 // Empty callbacks must not acquire/delete a lock on every successful import.
 // A concurrently inserted event remains durable for another callback or timer.
 if(!await db.prepare('SELECT 1 AS pending FROM notification_outbox LIMIT 1').first())return {status:'empty'};
 const claim=await db.prepare('INSERT INTO notification_delivery_lock(id,token,expires_at) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE expires_at<?').bind(token,now+60000,now).run();
 if(!claim.meta.changes)return {status:'busy'};
 try{
  const event=await db.prepare('SELECT id,created_at,payload FROM notification_outbox ORDER BY id LIMIT 1').first();
  if(!event)return {status:'empty'};
  const payload=JSON.parse(event.payload),league=payload.league;
  league.standings=standings(league,payload.results,event.created_at);
  for(const member of league.members){
   let saved=false;
   for(let attempt=0;attempt<2;attempt++){
    const row=await db.prepare('SELECT revision,payload FROM notification_accounts WHERE user_id=?').bind(member.id).first();
    const state=row?JSON.parse(row.payload):newNotificationAccount(event.created_at);
    if((state.sourceCursors?.[league.id]||0)>=event.id){saved=true;break;}
    const scoped={...state,events:state.events.filter((e:any)=>e.leagueId===league.id)};
    const next=reconcileNotifications(scoped,[league],member.id,event.created_at);
    next.events=[...state.events.filter((e:any)=>e.leagueId!==league.id),...next.events].filter((e:any)=>e.createdAt>=now-90*DAY).sort((a:any,b:any)=>b.createdAt-a.createdAt).slice(0,200);
    next.raceSnapshots={...state.raceSnapshots,...next.raceSnapshots};
    next.sourceCursors={...state.sourceCursors,[league.id]:event.id};
    const serialized=JSON.stringify(next);
    const result=row?await db.prepare('UPDATE notification_accounts SET payload=?,revision=revision+1 WHERE user_id=? AND revision=? AND EXISTS(SELECT 1 FROM notification_delivery_lock WHERE id=1 AND token=? AND expires_at>?)').bind(serialized,member.id,row.revision,token,Date.now()).run():await db.prepare('INSERT OR IGNORE INTO notification_accounts(user_id,payload) SELECT ?,? WHERE EXISTS(SELECT 1 FROM notification_delivery_lock WHERE id=1 AND token=? AND expires_at>?)').bind(member.id,serialized,token,Date.now()).run();
    if(result.meta.changes){saved=true;break;}
   }
   if(!saved)throw Error('Notification delivery needs retry');
  }
  await db.prepare('DELETE FROM notification_outbox WHERE id=? AND EXISTS(SELECT 1 FROM notification_delivery_lock WHERE id=1 AND token=? AND expires_at>?)').bind(event.id,token,Date.now()).run();
  return {status:'delivered',eventId:event.id};
 }finally{await db.prepare('DELETE FROM notification_delivery_lock WHERE id=1 AND token=?').bind(token).run();}
}

export async function notificationTick(now=Date.now()){
 const db=database();
 await disbandExpired(now); // Persist newly inactive picks and close expired leagues/trades even with no visitors.
 const rows=await db.prepare("SELECT state FROM leagues WHERE json_extract(state,'$.status') IN ('lobby','draft','ready')").all();
 for(const row of rows.results){
  const l=JSON.parse(row.state),deadline=cutoff(l.year),raceEnd=Date.parse(`${l.year}-07-01T04:00:00Z`);
  let key='';
  if(now<deadline&&now>=deadline-DAY)key=`deadline:${l.id}:${now>=deadline-3600000?'1h':'24h'}`;
  else if(l.status==='ready'&&now>=raceEnd&&now<raceEnd+90*DAY)key=`settlement:${l.id}:${Math.floor(now/900000)}`;
  if(!key)continue;
  await db.prepare("INSERT OR IGNORE INTO notification_outbox(event_key,created_at,payload) SELECT ?,?,json_object('league',json_remove(state,'$.invite'),'results',json(COALESCE((SELECT json_group_array(json(payload)) FROM race_results WHERE year=json_extract(leagues.state,'$.year') AND bird_id IN (SELECT json_extract(value,'$.birdId') FROM json_each(leagues.state,'$.picks'))),'[]'))) FROM leagues WHERE id=?").bind(key,now,l.id).run();
 }
 return {status:'checked'};
}

// Separate HTTP invocations keep delivery CPU/query budgets independent from imports and timer dispatch.
export async function pumpNotifications(env:any,tick=false,limit=12){
 if(!env.SYNC_SECRET||!env.APP_ORIGIN)throw Error('Notification processor configuration missing');
 const send=async(action:string)=>{
  const r=await fetch(env.APP_ORIGIN+'/api/notification-jobs',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${env.SYNC_SECRET}`},body:JSON.stringify({action}),redirect:'manual',signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error('Notification processor HTTP '+r.status);
  return r.json() as Promise<any>;
 };
 const finish=async(status:string)=>{if(tick)await env.DB.prepare("INSERT INTO sync_state(id,payload) VALUES('notification-processor',?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload").bind(JSON.stringify({lastCheckedAt:new Date().toISOString(),status})).run();return {status};};
 try{
  if(tick)await send('tick');
  for(let i=0;i<limit;i++){const result=await send('deliver');if(result.status!=='delivered')return await finish(result.status);}
  return await finish('more');
 }catch(e){await finish('retry-needed');throw e;}
}
