import {confirmedInside,ARRIVAL_CONTEXT_MS} from './gps-quality.mjs';
import {timestamp} from './feed.mjs';
import {seasonWindow} from './race.mjs';
// Reconcile a whole season, not the last 30 days or the displayed sampled trail.
export function arrivalCollector({year,individual,deployments,classify,interior=(lon,lat)=>false,now=Date.now()}){
 const {start,end}=seasonWindow(year),arrivals=new Map();let rows=0,validFixes=0,boundaryFixes=0;
 return {
  add(e){
   if(e.individual_local_identifier!==individual.local_identifier)throw Error('Race individual mismatch');
   rows++;
   const t=timestamp(e.timestamp),id=String(e.event_id||e.id||`${e.tag_local_identifier}:${t}`);
   arrivals.delete(id); // A corrected/hidden duplicate supersedes its previous version.
   const lon=Number(e.location_long),lat=Number(e.location_lat);
   if(e.individual_taxon_canonical_name!=='Ciconia ciconia'||e.visible!=='true'||!Number.isFinite(t)||t<start-ARRIVAL_CONTEXT_MS||t>=end+ARRIVAL_CONTEXT_MS||t>now||e.location_long==null||e.location_lat==null||e.location_long===''||e.location_lat===''||!Number.isFinite(lon)||!Number.isFinite(lat)||Math.abs(lon)>180||Math.abs(lat)>90)return;
   if(individual.mortality_date&&t>=timestamp(individual.mortality_date))return;
   if(!deployments.some(d=>String(d.individual_id)===String(individual.id)&&d.tag_local_identifier===e.tag_local_identifier&&timestamp(d.deploy_on_timestamp)<=t&&(!d.deploy_off_timestamp||t<timestamp(d.deploy_off_timestamp))))return;
   validFixes++;
   const position=classify(lon,lat);if(position==='boundary')boundaryFixes++;
   arrivals.set(id,{eventId:id,observedAt:new Date(t).toISOString(),longitude:lon,latitude:lat,tagId:String(e.tag_local_identifier)});
  },
  result(){const points=[...arrivals.values()].map(a=>[a.longitude,a.latitude,a.observedAt,a]);
   const found=confirmedInside(points,classify,p=>p[3].tagId,p=>Date.parse(p[2])>=start&&Date.parse(p[2])<end,interior);
   const arrival=found?{...found.point[3],confirmation:found.confirmation[3],...(found.before?{before:found.before[3]}:{}),support:found.support,qualityVersion:4}:null;
   return {arrival,eventRows:rows,validFixes,boundaryFixes};}
 };
}
