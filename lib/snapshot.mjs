export function validateSnapshot(s,now=Date.now()){
 if(!s||!Array.isArray(s.birds)||s.birds.length>500||!s.metadata||!Array.isArray(s.metadata.individuals)||!Array.isArray(s.metadata.deployments)||!s.state||!s.report)return false;
 const time=Date.parse(s.state.lastSuccessAt),start=Date.parse(s.report.startedAt);
 if(!Number.isFinite(time)||time>now+60000||time<now-3600000||!Number.isFinite(start)||start>time||start<now-20*60000)return false;
 if(s.report.studyId!==s.studyId||s.report.status!=='succeeded'||s.report.lastSuccessAt!==s.state.lastSuccessAt||typeof s.state.lastSuccessSlot!=='string')return false;
 const ids=new Set();return s.birds.every(b=>{if(!b||b.studyId!==s.studyId||b.id!==s.studyId+':'+b.name||ids.has(b.id))return false;ids.add(b.id);return Number.isFinite(b.latitude)&&Math.abs(b.latitude)<=90&&Number.isFinite(b.longitude)&&Math.abs(b.longitude)<=180&&Number.isFinite(b.distanceToGermanyMiles)&&b.distanceToGermanyMiles>=0&&Number.isFinite(Date.parse(b.latestValidFixUtc))&&Array.isArray(b.history)&&b.history.length<=250&&typeof b.currentDeployment==='boolean'&&typeof b.recordedDead==='boolean'&&typeof b.reviewRequired==='boolean';});
}
