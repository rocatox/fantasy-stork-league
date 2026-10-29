// Conservative coordinate-quality heuristics shared by display and corroborated arrivals.
export function distanceKm(a,b){const r=Math.PI/180,p=a[1]*r,q=b[1]*r,h=Math.sin((q-p)/2)**2+Math.cos(p)*Math.cos(q)*Math.sin((b[0]-a[0])*r/2)**2;return 12742*Math.asin(Math.min(1,Math.sqrt(h)));}
export function implausibleLeg(a,b){const km=distanceKm(a,b),hours=(Date.parse(b[2])-Date.parse(a[2]))/3600000;return km>5&&(hours<=0||km/hours>150);}

export const GPS_QUALITY_VERSION=3;
export const CONFIRM_MIN_MS=5*60000,CONFIRM_MAX_MS=48*3600000;
export function isolatedSpike(a,p,b){
 if(!a||!b)return false;
 if(implausibleLeg(a,p)&&implausibleLeg(p,b)&&!implausibleLeg(a,b))return true;
 const x=distanceKm(a,p),y=distanceKm(p,b),z=distanceKm(a,b),dt=Date.parse(b[2])-Date.parse(a[2]);
 // Sparse previews can conceal extreme speeds: also screen isolated long returns.
 return dt>0&&dt<=24*3600000&&Math.min(x,y)>250&&z<Math.min(x,y)*.1;
}
export function screenPoints(points){
 const sorted=[...points].sort((a,b)=>Date.parse(a[2])-Date.parse(b[2]));
 const excluded=new Set(sorted.filter((p,i)=>isolatedSpike(sorted[i-1],p,sorted[i+1])));
 // Quarantine short bursts of repeated bad coordinates as well as single spikes.
 // A jump and return to the pre-jump area is stronger evidence than speed alone.
 for(let i=1;i<sorted.length;i++){
  if(excluded.has(sorted[i-1])||excluded.has(sorted[i])||!implausibleLeg(sorted[i-1],sorted[i]))continue;
  const anchor=sorted[i-1],radius=Math.max(1,distanceKm(anchor,sorted[i])*.1);
  for(let j=i+1;j<Math.min(sorted.length,i+2048);j++){
   if(Date.parse(sorted[j][2])-Date.parse(anchor[2])>24*3600000)break;
   if(distanceKm(anchor,sorted[j])<=radius){for(let k=i;k<j;k++)excluded.add(sorted[k]);i=j;break;}
  }
 }
 const clean=sorted.filter(p=>!excluded.has(p)),suspect=new Set();
 for(let i=1;i<clean.length;i++)if(implausibleLeg(clean[i-1],clean[i])){suspect.add(clean[i-1]);suspect.add(clean[i]);}
 return {clean,excluded,suspect};
}
// Points are [lon,lat,time,source]; source carries the tag identity.
// Only a separate consistent inside fix confirms arrival; gaps/outside fixes reset it.
export function confirmedInside(points,classify,tag=p=>p[3]?.tagId||'',accept=()=>true){
 const {clean,suspect}=screenPoints(points);let candidate=null;
 for(const p of clean){
  if(suspect.has(p)||classify(p[0],p[1])!=='inside'){candidate=null;continue;}
  if(candidate){const dt=Date.parse(p[2])-Date.parse(candidate[2]);
   if(dt>CONFIRM_MAX_MS||tag(p)!==tag(candidate)||implausibleLeg(candidate,p))candidate=null;
   else if(dt>=CONFIRM_MIN_MS&&accept(candidate))return {point:candidate,confirmation:p};
  }
  if(!candidate&&accept(p))candidate=p;
 }
 return null;
}

