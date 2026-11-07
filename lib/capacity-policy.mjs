export function capacityWarnings(sample){
 const warnings=[];
 for(const [name,bytes] of Object.entries(sample.databases)){
  if(!Number.isFinite(bytes)||bytes<=0){warnings.push({level:'warning',code:'size-unavailable',message:name+': database size telemetry unavailable'});continue;}
  if(bytes>=450000000)warnings.push({level:'critical',code:'storage-critical',message:name+': at least 450 MB; expand free D1 archive capacity before more growth'});
  else if(bytes>=400000000)warnings.push({level:'warning',code:'storage-expand',message:name+': at least 400 MB; provision and verify another free D1 archive shard'});
  else if(bytes>=350000000)warnings.push({level:'warning',code:'storage-warning',message:name+': at least 350 MB; review growth and prepare archive expansion'});
 }
 if(sample.email.dailyUsed>=(sample.email.dailyCap||270)*0.8||sample.email.rollingUsed>=(sample.email.rollingCap||8100)*0.8)warnings.push({level:'warning',code:'email-budget',message:'Email attempts are at least 80% of the app free-plan budget'});
 if(sample.email.oldestPendingAt&&sample.checkedAt-sample.email.oldestPendingAt>=86400000)warnings.push({level:'warning',code:'email-backlog',message:'Some pending emails are at least 24 hours old; player emails expire after 48 hours'});
 return warnings;
}
export function capacityHistory(previous,sample){const day=new Date(sample.checkedAt).toISOString().slice(0,10);return [...(previous||[]).filter(s=>new Date(s.checkedAt).toISOString().slice(0,10)!==day),sample].sort((a,b)=>a.checkedAt-b.checkedAt).slice(-30);}
