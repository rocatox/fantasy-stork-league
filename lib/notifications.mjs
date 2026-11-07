import {cutoff,turn,DAY} from './rules.mjs';
import {birdName} from './bird-name.mjs';
export const NOTIFICATION_CATEGORIES=[
 ['draft','Draft & league stages','New managers joining your league, draft turns, and stage changes.'],
 ['trades','Trades','Proposals and their outcomes.'],
 ['replacements','Replacement opportunities','Inactive or deceased storks you can replace during trading.'],
 ['deadlines','Preseason reminders','Reminders in the final 24 hours and final hour.'],
 ['race','My race updates','Migration starts, arrivals and scoring corrections for your birds, plus your final league results.'],
 ['leagueRace','League race updates','Migration starts, arrivals and scoring corrections for every manager’s birds.']
];
export const notificationDefaults=Object.fromEntries(NOTIFICATION_CATEGORIES.flatMap(([key])=>[[key,true],['email_'+key,false]]));
export function notificationPreferences(value={}){return {...notificationDefaults,...value,leagueRace:typeof value.leagueRace==='boolean'?value.leagueRace:value.race!==false};}
export function notificationEnabled(preferences,event){const p=notificationPreferences(preferences);return event.title==='Final results'?p.race:event.category==='race'?(p.race||p.leagueRace):!!p[event.category];}
export function emailNotificationEnabled(preferences,event,since={}){const p=notificationPreferences(preferences);return notificationEnabled(Object.fromEntries(NOTIFICATION_CATEGORIES.map(([key])=>[key,p['email_'+key]===true&&event.createdAt>=(since[key]||0)])),event);}
export function newNotificationAccount(now){return {since:now,preferences:{...notificationDefaults},events:[],raceSnapshots:{},leagueSnapshots:{}};}
// Derive only from authoritative league/validated standings state. No GPS evidence is copied.
export function reconcileNotifications(account,leagues,user,now=Date.now()){
 const next=structuredClone(account),candidates=[],active=new Set(),snapshots={};
 next.preferences=notificationPreferences(next.preferences);
 const add=(l,key,category,title,body,time=now,actionable=false)=>{
  const id=l.id+':'+key;if(actionable)active.add(id);
  if(!actionable&&time<account.since)return;
  candidates.push({id,leagueId:l.id,leagueName:l.name,category,title,body,createdAt:time,actionable});
 };
 for(const l of leagues){
  if(!l.members?.some(m=>m.id===user)||['disbanded','abandoned'].includes(l.status))continue;
  const previousMembers=account.leagueSnapshots?.[l.id];
  const memberIds=l.members.map(m=>m.id),membershipRevision=(previousMembers?.revision||0)+(JSON.stringify(previousMembers?.members)!==JSON.stringify(memberIds)?1:0);
  next.leagueSnapshots={...next.leagueSnapshots,[l.id]:{members:memberIds,revision:membershipRevision}};
  if(l.owner===user&&previousMembers)for(const m of l.members)if(m.id!==user&&!previousMembers.members.includes(m.id))add(l,'joined:'+m.id+':'+membershipRevision,'draft','A manager joined',`${m.name||'A manager'} joined your league.`);
  const end=cutoff(l.year),open=now<end,own=(l.picks||[]).filter(p=>p.userId===user);
  const name=id=>l.members.find(m=>m.id===id)?.name||'A manager';
  if(l.status==='draft'&&open){
   if(l.draftStartedAt&&(l.draftStartedBy||l.owner)!==user)add(l,'draft-start','draft','The draft is open','Your league is ready to pick its flock.',Date.parse(l.draftStartedAt));
   if(l.members[turn(l.picks.length,l.members.length)]?.id===user&&(l.picks.length?l.picks.at(-1)?.userId:(l.draftStartedBy||l.owner))!==user)add(l,'turn:'+l.picks.length,'draft','Your pick','It’s your turn in the snake draft.',now,true);
  }
  if(l.status==='ready'&&open){
   if(l.draftCompletedAt&&(l.draftCompletedBy||l.picks.at(-1)?.userId)!==user)add(l,'trading','draft','Trading is open','Propose a trade or swap with the pool before January 15, 11:59 p.m. Eastern.',Date.parse(l.draftCompletedAt));
   for(const p of own)if(p.replacementRequired)add(l,'replacement:'+p.birdId+':'+p.pickedAt,'replacements','Replacement available',`${birdName(p.bird?.name||p.birdId)} is ${p.replacementRequired.reason}. Swap during trading before January 15, 11:59 p.m. Eastern. A recovered bird can still score with a confirmed arrival.`,now,true);
  }
  if(open&&end-now<=DAY&&['lobby','draft','ready'].includes(l.status)){
   const urgent=end-now<=3600000;
   add(l,'deadline:'+(urgent?'1h':'24h'),'deadlines',urgent?'Preseason ends within an hour':'Preseason ends within 24 hours',l.status==='ready'?'Finish trades and swaps by January 15, 11:59 p.m. Eastern.':'Finish drafting by January 15, 11:59 p.m. Eastern or this league will be disbanded.',now,true);
  }
  for(const t of l.trades||[]){
   if(t.from!==user&&t.to!==user)continue;
   if(t.status==='pending'&&open&&l.status==='ready'&&t.to===user)add(l,'trade:'+t.id+':pending','trades','Trade proposal',`${name(t.from)} offered a trade. Review the birds in your league.`,Date.parse(t.createdAt),true);
   else if(t.status!=='pending'&&t.resolvedAt&&(t.resolvedBy||(['accepted','declined'].includes(t.status)?t.to:t.reason==='Cancelled by proposer'?t.from:null))!==user)add(l,'trade:'+t.id+':'+t.status,'trades','Trade '+t.status,`${name(t.from)} → ${name(t.to)}.${t.reason?' '+t.reason+'.':''}`,Date.parse(t.resolvedAt));
  }
  const s=l.standings;
  if(s&&['not-started','racing','reconciling','complete'].includes(s.status)){
   const reliable=!s.dataPending&&!s.dataStale;
   const previous=account.raceSnapshots?.[l.id];
   const birds=(s.birds||[]).map(b=>{const old=previous?.birds.find(x=>x.id===b.birdId);return {id:b.birdId,userId:b.userId,migrationStart:b.migrationStart||null,migrationNotified:!!(old?.migrationNotified||old?.migrationStart||b.migrationStart),arrival:b.status==='awaiting-data'?(old?.arrival||null):b.arrival?.observedAt||null,points:reliable&&!b.notificationPointsPending?b.points:(old?.points||0),name:birdName(b.bird?.name||b.birdId),...(b.notificationPointsPending?{pointsPending:true}:{})};});
   const revision=(previous?.revision||0)+(JSON.stringify(previous?.birds)!==JSON.stringify(birds)?1:0);
   snapshots[l.id]={birds,status:s.status,revision};
   if(previous){
    for(const b of birds){const old=previous.birds.find(x=>x.id===b.id);if(!old)continue;
     if(b.migrationStart&&!old.migrationNotified&&!old.migrationStart&&Date.parse(b.migrationStart.confirmedAt)>=account.since)add(l,'migration-start:'+b.id,b.userId===user?'race':'leagueRace','Migration detected',`${b.name} (${b.userId===user?'your bird':name(b.userId)+'’s bird'}) shows sustained migration toward Germany. This is a conservative tracking estimate, not an exact departure time.`);
     if(b.arrival!==old.arrival||b.points!==old.points)add(l,'race:'+b.id+':'+revision,b.userId===user?'race':'leagueRace',b.arrival&&!old.arrival?'Arrival confirmed':'Race score updated',reliable&&!b.pointsPending?`${b.name} (${b.userId===user?'your bird':name(b.userId)+'’s bird'}): ${b.points} ${b.points===1?'point':'points'}. ${s.provisional?'Standings are provisional.':'See your league for the latest standings.'}`:`${b.name} (${b.userId===user?'your bird':name(b.userId)+'’s bird'}): ${b.arrival?'arrival confirmed':'arrival record corrected'}. Points will update when the remaining tracking checks finish.`);
    }
    if(s.status==='complete'&&previous.status!=='complete'){const team=s.teams.find(t=>t.userId===user);add(l,'results','race','Final results',`Your team finished ${team?.rank?'#'+team.rank:'the race'} with ${team?.points||0} points.`);}
   }
  }else if(account.raceSnapshots?.[l.id])snapshots[l.id]=account.raceSnapshots[l.id];
 }
 const existing=new Map(next.events.map(e=>[e.id,e]));
 for(const c of candidates){const old=existing.get(c.id);if(!old)existing.set(c.id,{...c,read:false,suppressed:!notificationEnabled(next.preferences,c),emailSuppressed:!emailNotificationEnabled(next.preferences,c,next.emailEnabledSince)});else if(c.actionable)existing.set(c.id,{...old,body:c.body});}
 const visibleLeagues=new Set(leagues.filter(l=>!['disbanded','abandoned'].includes(l.status)).map(l=>l.id));
 next.events=[...existing.values()].filter(e=>e.createdAt>=now-90*DAY).map(e=>({...e,active:visibleLeagues.has(e.leagueId)&&(!e.actionable||active.has(e.id))})).sort((a,b)=>b.createdAt-a.createdAt).slice(0,200);
 next.raceSnapshots=snapshots;return next;
}
export function notificationResponse(account){const items=account.events.filter(e=>e.createdAt>=Date.now()-90*DAY).sort((a,b)=>b.createdAt-a.createdAt).slice(0,200).filter(e=>!e.suppressed&&notificationEnabled(account.preferences,e));return {preferences:notificationPreferences(account.preferences),items,unread:items.filter(e=>!e.read).length};}
