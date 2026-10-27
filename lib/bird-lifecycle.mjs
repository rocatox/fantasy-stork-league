const DAY=86400000;
export function birdStatus(b,now=Date.now()){
 if(b.recordedDead)return 'deceased';
 const fix=Date.parse(b.latestValidFixUtc);
 return !Number.isFinite(fix)||now-fix>30*DAY?'inactive':'active';
}
export function seasonProtected(now=Date.now()){
 const year=new Date(now).getUTCFullYear();
 return now>=Date.parse(`${year}-01-16T05:00:00Z`)&&now<Date.parse(`${year}-07-31T04:00:00Z`);
}
export function keepBird(b,now=Date.now()){return birdStatus(b,now)==='active'||seasonProtected(now);}
export function birdRecord(b){return {id:b.id,name:b.name,studyId:b.studyId,study:b.study,ringId:b.ringId||null,sourceUrl:b.sourceUrl};}
// Cache only roster metadata. Daily discovery still fetches every source individual.
export function rosterMetadata(metadata,birds){
 const names=new Set(birds.map(b=>b.name));
 const individuals=(metadata.individuals||[]).filter(a=>names.has(a.local_identifier));
 const ids=new Set(individuals.map(a=>String(a.id)));
 return {...metadata,individuals,deployments:(metadata.deployments||[]).filter(d=>ids.has(String(d.individual_id)))};
}
