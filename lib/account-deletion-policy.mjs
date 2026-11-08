export const DELETED_NAME='Deleted manager';
export function anonymizeLeague(value,job){
 const league=replaceIdentity(value,job);
 const original=value.members?.find(m=>m.id===job.user_id);
 if(!original)return league;
 const successor=league.members.map((m,i)=>({m,order:Number.isFinite(m.joinedOrder)?m.joinedOrder:i})).filter(({m})=>m.id!==job.alias&&!m.deleted).sort((a,b)=>a.order-b.order)[0]?.m;
 if(value.owner===job.user_id&&successor)league.owner=successor.id;
 if(value.status==='lobby'){
  league.members=league.members.filter(m=>m.id!==job.alias);
  if(value.owner===job.user_id){
   // Lobby member order is join order, before the draft shuffles it.
   league.owner=successor?.id||job.alias;
   if(!league.members.some(m=>!m.deleted)){
    league.status='disbanded';league.disbandReason='No remaining managers';
    league.disbandedAt=new Date(job.requested_at).toISOString();league.invite='deleted-'+league.id;
   }
  }
 }else league.members=league.members.map(m=>m.id===job.alias?{id:job.alias,name:DELETED_NAME,deleted:true}:m);
 for(const t of league.trades||[])if(t.status==='pending'&&(t.from===job.alias||t.to===job.alias)){
  t.status='cancelled';t.reason='Manager deleted their account';t.resolvedAt=new Date(job.requested_at).toISOString();t.resolvedBy=job.alias;
 }
 return league;
}
export function replaceIdentity(value,job){
 if(typeof value==='string')return value===job.user_id?job.alias:value;
 if(Array.isArray(value))return value.map(v=>replaceIdentity(v,job));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k===job.user_id?job.alias:k,replaceIdentity(v,job)]));
 return value;
}
export function anonymizeSnapshot(value,job){
 const next=replaceIdentity(value,job);
 if(value.league)next.league=anonymizeLeague(value.league,job);
 return next;
}
export function anonymizeNotifications(value,job){
 const text=s=>s.split(job.user_id).join(job.alias);
 const walk=v=>typeof v==='string'?text(v):Array.isArray(v)?v.map(walk):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[text(k),walk(x)])):v;
 const next=walk(value);
 // Redaction is not a new event. Never create mail because an event ID changed.
 next.events=next.events?.map((e,i)=>JSON.stringify(e)!==JSON.stringify(value.events[i])?{...e,emailSuppressed:true}:e)||[];
 return next;
}
