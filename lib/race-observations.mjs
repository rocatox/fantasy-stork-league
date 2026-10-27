import {timestamp} from './feed.mjs';
import {seasonWindow} from './race.mjs';
// Reconcile a whole season, not the last 30 days or the displayed sampled trail.
export function arrivalCollector({year,individual,deployments,classify,now=Date.now()}){
 const {start,end}=seasonWindow(year),arrivals=new Map();let rows=0,validFixes=0,boundaryFixes=0;
 return {
  add(e){
   if(e.individual_local_identifier!==individual.local_identifier)throw Error('Race individual mismatch');
   rows++;
   const t=timestamp(e.timestamp),id=String(e.event_id||e.id||`${e.tag_local_identifier}:${t}`);
   arrivals.delete(id); // A corrected/hidden duplicate supersedes its previous version.
   const lon=Number(e.location_long),lat=Number(e.location_lat);
   if(e.individual_taxon_canonical_name!=='Ciconia ciconia'||e.visible!=='true'||!Number.isFinite(t)||t<start||t>=end||t>now||e.location_long==null||e.location_lat==null||e.location_long===''||e.location_lat===''||!Number.isFinite(lon)||!Number.isFinite(lat)||Math.abs(lon)>180||Math.abs(lat)>90)return;
   if(individual.mortality_date&&t>=timestamp(individual.mortality_date))return;
   if(!deployments.some(d=>String(d.individual_id)===String(individual.id)&&d.tag_local_identifier===e.tag_local_identifier&&timestamp(d.deploy_on_timestamp)<=t&&(!d.deploy_off_timestamp||t<timestamp(d.deploy_off_timestamp))))return;
   validFixes++;
   const position=classify(lon,lat);if(position==='boundary'){boundaryFixes++;return;}if(position!=='inside')return;
   arrivals.set(id,{eventId:id,observedAt:new Date(t).toISOString(),longitude:lon,latitude:lat,tagId:String(e.tag_local_identifier)});
  },
  result(){let arrival=null;for(const a of arrivals.values())if(!arrival||a.observedAt<arrival.observedAt||a.observedAt===arrival.observedAt&&a.eventId<arrival.eventId)arrival=a;
   return {arrival,eventRows:rows,validFixes,boundaryFixes};}
 };
}
