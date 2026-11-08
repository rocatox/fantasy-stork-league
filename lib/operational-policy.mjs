import {syncPolicy} from './sync-policy.mjs';
export const STUDY_IDS=['10449318','212096177','173641633','864730855','4809963363','21231406','24442409','76367850'];
export const HOUR=3600000;
export function operationalChecks(sample){
 const {now}=sample,checks=[];
 const add=(id,level,message)=>checks.push({id,level,message});
 if(sample.backup.error)add('backup','unknown','Backup verification status unavailable; inspect GitHub backup workflow access.');
 else if(!sample.backup.completedAt||now-Date.parse(sample.backup.completedAt)>30*HOUR)add('backup','critical','No verified backup workflow completed within 30 hours. Inspect backup.yml and the private Drive backup folder.');
 else add('backup','ok','A verified backup workflow completed within 30 hours.');
 if(sample.sources.error)add('sync','unknown','Study sync state could not be read.');
 else {
  const limit=(syncPolicy(now).intervalHours+1.5)*HOUR;
  const overdue=STUDY_IDS.filter(id=>{const t=Date.parse(sample.sources.values.find(s=>s.studyId===id)?.lastSuccessAt);return !Number.isFinite(t)||t>now+300000||now-t>limit;});
  add('sync',overdue.length?'critical':'ok',overdue.length?`Overdue study imports: ${overdue.join(', ')}. Check the Cloudflare timer and sync.yml logs.`:'All eight study imports are current.');
 }
 for(const [key,size] of Object.entries(sample.databases)){
  const level=!Number.isFinite(size)||size<=0?'unknown':size>=450000000?'critical':size>=400000000?'warning-expand':size>=350000000?'warning':'ok';
  add('storage:'+key,level,level==='unknown'?`${key}: database size unavailable.`:`${key}: ${(size/1000000).toFixed(1)} MB. ${size>=400000000?'Provision and verify additional free archive capacity.':size>=350000000?'Prepare archive expansion.':'Below storage warning threshold.'}`);
 }
 const e=sample.email;
 if(e.error)add('email','unknown','Email queue telemetry unavailable.');
 else {const age=e.oldest?now-e.oldest:0,level=e.pending>=500||age>=24*HOUR||e.failed>0?'critical':e.pending>=100||age>=HOUR?'warning':'ok';
  add('email',level,`${e.pending} pending player/bug-report emails; oldest ${(age/HOUR).toFixed(1)} hours; ${e.failed} failed or uncertain deliveries in the last 24 hours. Check sender health and free-plan allowance.`);}
 return checks;
}
// Require two consecutive abnormal samples; notify on escalation, daily reminder,
// or two healthy samples after an alerted incident. Unknown is not recovery.
export function alertTransition(previous,check,now){
 const old=previous||{},bad=check.level!=='ok',same=old.level===check.level;
 const state={...old,...check,checkedAt:now,streak:same?(old.streak||0)+1:1};
 let notice=null;
 if(bad&&state.streak>=2&&(!old.alerted||old.notifiedLevel!==check.level||now-(old.lastNotifiedAt||0)>=24*HOUR))notice=check;
 if(!bad&&state.streak>=2&&old.alerted)notice={...check,level:'recovered'};
 if(notice){state.alerted=bad;state.notifiedLevel=check.level;state.lastNotifiedAt=now;}
 return {state,notice};
}
