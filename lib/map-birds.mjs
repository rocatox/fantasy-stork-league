import {eligible} from './rules.mjs';
export const RESEARCH_COLOR='#858b8a';
export function explorerBirds(birds,{only=true,study='all',query='',now=Date.now()}={}){return birds.filter(b=>(!only||eligible(b,now))&&(study==='all'||b.studyId===study)&&`${b.name} ${b.country} ${b.ringId}`.toLowerCase().includes(query.toLowerCase()));}
export function explorerColor(b,now=Date.now()){return eligible(b,now)?'#c29a34':RESEARCH_COLOR;}
