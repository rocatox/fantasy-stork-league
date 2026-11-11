import {birdName} from './bird-name.mjs';
import {notificationEnabled} from './notifications.mjs';
const DAY=86400000;
const identity=b=>b.studyId+':'+(b.individualId||b.id);
export function storkImportEvents(previous,incoming,seen=[],established=false,now=Date.now()){
 const known=new Set([...seen,...previous.map(identity)]),events=[];
 const byId=new Map(previous.map(b=>[b.id,b])),byIdentity=new Map(previous.map(b=>[identity(b),b]));
 for(const bird of incoming){
  const key=identity(bird),old=byId.get(bird.id)||byIdentity.get(key),name=birdName(bird.name);
  const add=(kind,title,body)=>events.push({id:'stork:'+kind+':'+key,category:'storks',title,body,birdId:bird.id,createdAt:now,actionable:false,active:true,emailSuppressed:true});
  if(old&&!old.recordedDead&&bird.recordedDead&&!known.has('death:'+key)){
   const day=String(bird.mortalityDate||'').slice(0,10),valid=/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day))&&new Date(day).toISOString().slice(0,10)===day&&day<=new Date(now).toISOString().slice(0,10);
   const date=valid?new Date(day+'T12:00:00Z').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}):null;
   add('death','Remembering '+name,date?`On ${date}, ${name} passed away. May we keep them in our hearts.`:`We learned that ${name} passed away. May we keep them in our hearts.`);
   known.add('death:'+key);
  }else if(established&&!old&&!known.has(key)&&!bird.recordedDead){
   add('new','A new stork to scout',`${name} has joined the app. Explore their profile and migration history.`);
  }
  known.add(key);
 }
 return {events,seen:[...known]};
}
export function mergeStorkEvents(account,rows,now=Date.now()){
 const next={...account},events=new Map(account.events.map(e=>[e.id,e]));
 for(const row of rows){
  next.storkCursor=Math.max(next.storkCursor||0,Number(row.id));
  const event=typeof row.payload==='string'?JSON.parse(row.payload):row.payload;
  if(event.createdAt<account.since||event.createdAt<now-90*DAY||events.has(event.id))continue;
  events.set(event.id,{...event,read:false,suppressed:!notificationEnabled(account.preferences,event),emailSuppressed:true});
 }
 next.events=[...events.values()].filter(e=>e.createdAt>=now-90*DAY).sort((a,b)=>b.createdAt-a.createdAt).slice(0,200);
 return next;
}
