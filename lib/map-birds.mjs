import {birdName} from './bird-name.mjs';
import {eligible} from './rules.mjs';
export const RESEARCH_COLOR='#858b8a';
export function explorerBirds(birds,{only=true,study='all',query='',now=Date.now()}={}){return birds.filter(b=>(!only||eligible(b,now))&&(study==='all'||b.studyId===study)&&`${birdName(b.name)} ${b.name} ${b.country} ${b.ringId}`.toLowerCase().includes(query.toLowerCase()));}
export function explorerColor(b,now=Date.now()){return eligible(b,now)?'#c29a34':RESEARCH_COLOR;}

export function compareBirds(a,b,sort,rankings={}){
 const name=()=>birdName(a.name).localeCompare(birdName(b.name),undefined,{numeric:true})||a.id.localeCompare(b.id);
 if(sort==='success'||sort==='arrival'){
  const x=rankings[a.id],y=rankings[b.id];
  const known=s=>s&&!s.pendingYears&&s.attempts>0&&(sort==='success'||!!s.typicalArrival);
  const hasX=!!known(x),hasY=!!known(y);
  if(hasX!==hasY)return hasX?-1:1;if(!hasX)return name();
  if(sort==='success')return y.successes/y.attempts-x.successes/x.attempts||y.attempts-x.attempts||name();
  return x.typicalArrival.localeCompare(y.typicalArrival)||name();
 }
 if(sort==='name')return name();
 if(sort==='freshness')return Date.parse(b.latestValidFixUtc)-Date.parse(a.latestValidFixUtc)||name();
 return a.distanceToGermanyMiles-b.distanceToGermanyMiles||name();
}
