import {boundedJson,RequestBodyError} from '../../../lib/bounded-json';
import {getUser} from '../../../lib/auth';
import {database,json,safeWrite} from '../../../lib/store';
import {LIST_ICONS} from '../../../lib/list-icons.mjs';
async function read(user:string){
 const db=database();
 const rows=await db.prepare(`SELECT l.id,l.name,l.icon,b.bird_id FROM scout_lists l LEFT JOIN scout_list_birds b ON b.list_id=l.id WHERE l.user_id=? ORDER BY l.slot,b.bird_id`).bind(user).all();
 const lists:any[]=[];
 for(const row of rows.results as any[]){let list=lists.find(l=>l.id===row.id);if(!list){list={id:row.id,name:row.name,icon:row.icon,birdIds:[]};lists.push(list);}if(row.bird_id)list.birdIds.push(row.bird_id);}
 return json({lists});
}
export async function GET(req:Request){const u=await getUser(req);return u?read(u.userId):json({error:'Sign in to use your private lists'},401);}
export async function POST(req:Request){
 if(!safeWrite(req))return json({error:'Same-origin JSON required'},403);
 const u=await getUser(req);if(!u)return json({error:'Sign in to use your private lists'},401);
 let b:any;try{b=await boundedJson(req);}catch(e){return json({error:e instanceof RequestBodyError?e.message:'Invalid request'},e instanceof RequestBodyError?e.status:400);}
 if(!b||typeof b!=='object'||Array.isArray(b))return json({error:'Invalid request'},400);
 const db=database();
 if(b.action==='create'){
  const name=typeof b.name==='string'?b.name.trim():'';
  if(!name||Array.from(name).length>15||/[\u0000-\u001f\u007f]/.test(name)||!LIST_ICONS.some(i=>i.id===b.icon))return json({error:'Use a name of 1–15 characters and choose an icon'},400);
  const id=crypto.randomUUID();
  const result=await db.prepare(`INSERT OR IGNORE INTO scout_lists(id,user_id,name,icon,slot) SELECT ?,?,?,?,slot FROM (SELECT 1 slot UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5) AS slot_candidates WHERE NOT EXISTS(SELECT 1 FROM scout_lists WHERE user_id=? AND scout_lists.slot=slot_candidates.slot) ORDER BY slot LIMIT 1`).bind(id,u.userId,name,b.icon,u.userId).run();
  if(!result.meta.changes)return json({error:'You can have five lists. Each needs a different name and icon.'},409);
  return read(u.userId);
 }
 if(typeof b.id!=='string')return json({error:'Choose a list'},400);
 if(b.action==='delete'){
  const result=await db.prepare('DELETE FROM scout_lists WHERE id=? AND user_id=?').bind(b.id,u.userId).run();
  if(!result.meta.changes)return json({error:'List not found'},404);
 }else if(b.action==='membership'){
  if(typeof b.birdId!=='string'||!b.birdId||b.birdId.length>200||typeof b.add!=='boolean')return json({error:'Invalid bird membership'},400);
  if(!await db.prepare('SELECT id FROM scout_lists WHERE id=? AND user_id=?').bind(b.id,u.userId).first())return json({error:'List not found'},404);
  if(b.add){
   if(!await db.prepare('SELECT id FROM birds WHERE id=?').bind(b.birdId).first())return json({error:'This bird is no longer available'},404);
   await db.prepare('INSERT OR IGNORE INTO scout_list_birds(list_id,bird_id) SELECT id,? FROM scout_lists WHERE id=? AND user_id=?').bind(b.birdId,b.id,u.userId).run();
  }else await db.prepare('DELETE FROM scout_list_birds WHERE bird_id=? AND list_id IN (SELECT id FROM scout_lists WHERE id=? AND user_id=?)').bind(b.birdId,b.id,u.userId).run();
 }else return json({error:'Unknown list action'},400);
 return read(u.userId);
}
