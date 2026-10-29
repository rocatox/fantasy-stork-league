import {implausibleLeg,CONFIRM_MIN_MS,CONFIRM_MAX_MS} from './gps-quality.mjs';
import {cutoff} from './rules.mjs';
export const RACE_VERSION=2;
export const PROVISIONAL_MS=72*60*60*1000;
export function seasonWindow(year){
 if(!Number.isInteger(year)||year<2026||year>2100)throw Error('Invalid season');
 return {start:cutoff(year),end:Date.parse(`${year}-07-01T04:00:00Z`)};
}
export function validArrival(a,year,now=Date.now()){
 if(a===null)return true;
 const {start,end}=seasonWindow(year),t=Date.parse(a?.observedAt),c=a?.confirmation,ct=Date.parse(c?.observedAt);
 if(a?.qualityVersion!==2||!c||c.eventId===a.eventId||typeof c.eventId!=='string'||!c.eventId||c.tagId!==a.tagId||!Number.isFinite(ct)||ct>now||ct-t<CONFIRM_MIN_MS||ct-t>CONFIRM_MAX_MS||!Number.isFinite(c.longitude)||Math.abs(c.longitude)>180||!Number.isFinite(c.latitude)||Math.abs(c.latitude)>90||implausibleLeg([a.longitude,a.latitude,a.observedAt],[c.longitude,c.latitude,c.observedAt]))return false;
 return typeof a?.eventId==='string'&&a.eventId.length>0&&a.eventId.length<=200&&Number.isFinite(t)&&new Date(t).toISOString()===a.observedAt&&t>=start&&t<end&&t<=now&&Number.isFinite(a.longitude)&&Math.abs(a.longitude)<=180&&Number.isFinite(a.latitude)&&Math.abs(a.latitude)<=90&&typeof a.tagId==='string';
}
export function reconcileResult(previous,result,now=Date.now()){
 const changed=!previous||previous.version!==RACE_VERSION||JSON.stringify(previous.arrival)!==JSON.stringify(result.arrival)||previous.boundaryVersion!==result.boundaryVersion;
 return {...result,version:RACE_VERSION,checkedAt:new Date(now).toISOString(),changedAt:changed?new Date(now).toISOString():previous.changedAt,revision:(previous?.revision||0)+(changed?1:0)};
}
// Inputs are already restricted to a member's league by the endpoint.
export function standings(league,results,now=Date.now()){
 const {start,end}=seasonWindow(league.year);
 const eligibleLeague=league.status==='ready'&&league.picks.length>0&&league.size>0&&league.members.every(m=>league.picks.filter(p=>p.userId===m.id).length===league.size);
 const base={year:league.year,start:new Date(start).toISOString(),end:new Date(end).toISOString(),rulesVersion:RACE_VERSION};
 if(!eligibleLeague)return {...base,status:league.status==='disbanded'?'disbanded':'draft-incomplete',teams:[],birds:[],provisional:false};
 const byId=new Map(results.filter(r=>r.year===league.year).map(r=>[r.birdId,r]));
 let pending=false,stale=false,changedAt=start,checkedAt=Infinity,coverageThrough=Infinity;
 const birds=league.picks.map(p=>{
  if(p.replacementRequired)return {birdId:p.birdId,bird:p.bird||null,userId:p.userId,arrival:null,rank:null,points:0,status:now<start?'replacement-available':'not-replaced',checkedAt:null};
  const result=byId.get(p.birdId),checked=Date.parse(result?.checkedAt),change=Date.parse(result?.changedAt);
  const valid=result?.version===RACE_VERSION&&validArrival(result.arrival,league.year,now);
  if(!valid)pending=true;
  if(valid&&now>=end&&(Date.parse(result.startedAt)||checked)<end)pending=true;
  if(valid){coverageThrough=Math.min(coverageThrough,Date.parse(result.startedAt)||checked);checkedAt=Math.min(checkedAt,checked);changedAt=Math.max(changedAt,change||start);if(checked<Math.min(now,end)-(now<end?2*60*60*1000:12*60*60*1000))stale=true;}
  const arrival=valid&&now>=start?result.arrival:null;
  return {birdId:p.birdId,bird:p.bird||null,userId:p.userId,arrival,rank:null,points:0,status:now<start?'not-started':!valid?'awaiting-data':arrival?'arrived':now>=end?'nonfinisher':'racing',checkedAt:valid?result.checkedAt:null};
 });
 const finishers=birds.filter(b=>b.arrival).sort((a,b)=>a.arrival.observedAt.localeCompare(b.arrival.observedAt)||a.birdId.localeCompare(b.birdId));
 for(let i=0;i<finishers.length;){let j=i+1;while(j<finishers.length&&finishers[j].arrival.observedAt===finishers[i].arrival.observedAt)j++;
  const points=birds.length-i-(j-i-1)/2;
  for(let k=i;k<j;k++){finishers[k].rank=i+1;finishers[k].points=points;}i=j;
 }
 const teams=league.members.map(m=>({userId:m.id,name:m.name,points:birds.filter(b=>b.userId===m.id).reduce((n,b)=>n+b.points,0),arrivals:birds.filter(b=>b.userId===m.id&&b.arrival).length,rank:0})).sort((a,b)=>b.points-a.points||a.userId.localeCompare(b.userId));
 teams.forEach((t,i)=>t.rank=i&&teams[i-1].points===t.points?teams[i-1].rank:i+1);
 const provisionalUntil=Math.max(changedAt+PROVISIONAL_MS,now>=end?end+PROVISIONAL_MS:0);
 const settled=now>=end&&!pending&&!stale&&coverageThrough>=end&&now>=provisionalUntil;
 return {...base,status:now<start?'not-started':settled?'complete':now>=end?'reconciling':'racing',provisional:now>=start&&(!settled&&(pending||stale||now<provisionalUntil)),provisionalUntil:new Date(provisionalUntil).toISOString(),dataPending:pending,dataStale:stale,checkedAt:Number.isFinite(checkedAt)?new Date(checkedAt).toISOString():null,teams,birds:birds.sort((a,b)=>(a.rank??Infinity)-(b.rank??Infinity)||a.birdId.localeCompare(b.birdId))};
}
