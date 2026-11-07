import {newInviteCode,inviteCode} from './invite.mjs';
export async function availableInvite(db:any){
 for(let i=0;i<20;i++){const code=newInviteCode();if(!await db.prepare('SELECT id FROM leagues WHERE invite=?').bind(code).first())return code;}
 throw new Error('Unable to allocate invite code; retry shortly');
}
export async function ensureInvite(db:any,league:any){
 if(league.status!=='lobby'||inviteCode(league.invite))return league;
 for(let i=0;i<20;i++){
  const code=await availableInvite(db);
  const result=await db.prepare("UPDATE OR IGNORE leagues SET invite=?,state=json_set(state,'$.invite',?),revision=revision+1 WHERE id=? AND invite=?").bind(code,code,league.id,league.invite).run();
  if(result.meta.changes)return {...league,invite:code};
  const row=await db.prepare('SELECT state FROM leagues WHERE id=?').bind(league.id).first();
  if(!row)return league;league=JSON.parse(row.state);
  if(league.status!=='lobby'||inviteCode(league.invite))return league;
 }
 throw new Error('Unable to allocate invite code; retry shortly');
}
export async function allowJoinAttempt(db:any,userId:string,now:number){
 const key='league-join-rate:'+userId,window=Math.floor(now/600000);
 const row=await db.prepare(`INSERT INTO sync_state(id,payload) VALUES(?,json_object('window',?,'count',1)) ON CONFLICT(id) DO UPDATE SET payload=json_object('window',?,'count',CASE WHEN json_extract(payload,'$.window')=? THEN json_extract(payload,'$.count')+1 ELSE 1 END) RETURNING payload`).bind(key,window,window,window).first();
 return JSON.parse(row.payload).count<=10;
}
