import {getUser} from '../../../lib/auth';
import {database,json,safeWrite} from '../../../lib/store';
import {addStandings} from '../../../lib/standings';
import {cleanTrades} from '../../../lib/trades.mjs';
import {shouldDisband} from '../../../lib/sync-policy.mjs';
import {newNotificationAccount,reconcileNotifications,notificationResponse,notificationDefaults} from '../../../lib/notifications.mjs';

async function update(user:string,body:any){
 const db=database(),now=Date.now();
 for(let attempt=0;attempt<4;attempt++){
  const row=await db.prepare('SELECT revision,payload FROM notification_accounts WHERE user_id=?').bind(user).first();
  // Read source state after the revision: a conflicting device retries both snapshots.
  const rows=await db.prepare("SELECT state FROM leagues WHERE EXISTS (SELECT 1 FROM json_each(leagues.state,'$.members') WHERE json_extract(value,'$.id')=?)").bind(user).all();
  const own=rows.results.map((r:any)=>JSON.parse(r.state)).filter((l:any)=>!shouldDisband(l,now));
  for(const l of own)cleanTrades(l,now);
  const leagues=await addStandings(own);
  const first=!row?await db.prepare("SELECT created_at FROM notification_outbox WHERE EXISTS(SELECT 1 FROM json_each(payload,'$.league.members') WHERE json_extract(value,'$.id')=?) ORDER BY id LIMIT 1").bind(user).first():null;
  let state=row?JSON.parse(row.payload):newNotificationAccount(first?.created_at||now);
  // Inbox reads never create events or advance the background processor's race baseline.
  const current=reconcileNotifications(state,leagues,user,now);
  const active=new Map(current.events.map((e:any)=>[e.id,e.active]));
  const available=new Set(own.filter((l:any)=>!['disbanded','abandoned'].includes(l.status)).map((l:any)=>l.id));
  state.events=state.events.map((e:any)=>({...e,active:!!active.get(e.id)&&available.has(e.leagueId),leagueAvailable:available.has(e.leagueId)}));
  if(body?.action==='preferences'){
   state.preferences={...state.preferences,...body.preferences};
   // Disabling a category also retires its current unread prompts; re-enabling is prospective.
   state.events=state.events.map((e:any)=>state.preferences[e.category]?e:{...e,suppressed:true});
  }
  if(body?.action==='read')state.events=state.events.map((e:any)=>body.id===e.id?{...e,read:true}:e);
  if(body?.action==='readAll')state.events=state.events.map((e:any)=>({...e,read:true}));
  const payload=JSON.stringify(state);
  if(row?.payload===payload)return json(notificationResponse(state));
  const result=row?await db.prepare('UPDATE notification_accounts SET payload=?,revision=revision+1 WHERE user_id=? AND revision=?').bind(payload,user,row.revision).run():await db.prepare('INSERT OR IGNORE INTO notification_accounts(user_id,payload) VALUES (?,?)').bind(user,payload).run();
  if(result.meta.changes)return json(notificationResponse(state));
 }
 return json({error:'Notifications changed on another device. Please retry.'},409);
}
export async function GET(req:Request){const u=await getUser(req);return u?update(u.userId,null):json({error:'Sign in to view notifications'},401);}
export async function POST(req:Request){
 if(!safeWrite(req))return json({error:'Same-origin JSON required'},403);
 const u=await getUser(req);if(!u)return json({error:'Sign in to manage notifications'},401);
 let b:any;try{b=await req.json();}catch{return json({error:'Invalid request'},400);}
 if(!b||!['preferences','read','readAll'].includes(b.action))return json({error:'Unknown notification action'},400);
 if(b.action==='read'&&(typeof b.id!=='string'||b.id.length>1000))return json({error:'Choose a notification'},400);
 if(b.action==='preferences'&&(!b.preferences||Array.isArray(b.preferences)||typeof b.preferences!=='object'||!Object.keys(b.preferences).length||Object.entries(b.preferences).some(([k,v])=>!Object.hasOwn(notificationDefaults,k)||typeof v!=='boolean')))return json({error:'Invalid notification preferences'},400);
 return update(u.userId,b);
}
