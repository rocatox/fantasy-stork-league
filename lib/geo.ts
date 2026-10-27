import geometry from '../data/germany-vg25.json';
import source from '../data/boundary-source.json';
import overview from '../data/map.json';
import geodesic from 'geographiclib-geodesic';
export const BOUNDARY_VERSION=source.version;
const geod=geodesic.Geodesic.WGS84;
const rad=Math.PI/180;
const vec=(p:number[])=>[Math.cos(p[1]*rad)*Math.cos(p[0]*rad),Math.cos(p[1]*rad)*Math.sin(p[0]*rad),Math.sin(p[1]*rad)];
const dot=(a:number[],b:number[])=>a.reduce((s,x,i)=>s+x*b[i],0);
const cross=(a:number[],b:number[])=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=(v:number[])=>Math.sqrt(dot(v,v));
const angle=(a:number[],b:number[])=>Math.atan2(norm(cross(a,b)),dot(a,b));
const edges:any[]=[];
// Latitude strips make full-resolution arrival checks cheap, even for dense GPS feeds.
const strips=new Map<number,any[]>();
for(const polygon of geometry.coordinates)for(const ring of polygon)for(let i=1;i<ring.length;i++){
 const a=ring[i-1],b=ring[i];if(a[0]===b[0]&&a[1]===b[1])continue;
 const e={a,b};edges.push(e);
 for(let k=Math.floor(Math.min(a[1],b[1])*100);k<=Math.floor(Math.max(a[1],b[1])*100);k++){
  if(!strips.has(k))strips.set(k,[]);strips.get(k)!.push(e);
 }
}
export function germanyPosition(lon:number,lat:number):'inside'|'outside'|'boundary'{
 if(!Number.isFinite(lon)||!Number.isFinite(lat)||lon<5||lon>16||lat<47||lat>56)return 'outside';
 let inside=false;
 for(const {a,b} of strips.get(Math.floor(lat*100))||[]){
  const determinant=(lon-a[0])*(b[1]-a[1])-(lat-a[1])*(b[0]-a[0]);
  if(Math.abs(determinant)<1e-12&&lon>=Math.min(a[0],b[0])-1e-10&&lon<=Math.max(a[0],b[0])+1e-10&&lat>=Math.min(a[1],b[1])-1e-10&&lat<=Math.max(a[1],b[1])+1e-10)return 'boundary';
  if((a[1]>lat)!==(b[1]>lat)&&lon<(b[0]-a[0])*(lat-a[1])/(b[1]-a[1])+a[0])inside=!inside;
 }
 return inside?'inside':'outside';
}
export const inGermany=(lon:number,lat:number)=>germanyPosition(lon,lat)==='inside';
function inRing(lon:number,lat:number,r:number[][]){let inside=false;for(let i=0,j=r.length-1;i<r.length;j=i++){if((r[i][1]>lat)!==(r[j][1]>lat)&&lon<(r[j][0]-r[i][0])*(lat-r[i][1])/(r[j][1]-r[i][1])+r[i][0])inside=!inside;}return inside;}
export function countryLabel(lon:number,lat:number){if(germanyPosition(lon,lat)!=='outside')return {code:'DE',name:'Germany'};const c=overview.find(c=>c.code!=='DE'&&c.rings.some(r=>inRing(lon,lat,r)));return c?{code:c.code,name:c.name}:{code:null,name:'See coordinates'};}
let segments:any[]|undefined;
export function distanceMiles(lon:number,lat:number){
 if(!Number.isFinite(lon)||!Number.isFinite(lat)||Math.abs(lon)>180||Math.abs(lat)>90)throw Error('Invalid coordinates');
 if(germanyPosition(lon,lat)!=='outside')return 0;
 segments??=edges.map(({a,b})=>{const av=vec(a),bv=vec(b),v=cross(av,bv),n=norm(v);return {a,b,av,bv,n:v.map(x=>x/n),ab:angle(av,bv)};});
 const p=vec([lon,lat]);let best=Infinity;
 // 6,335 km is below WGS84's minimum radius of curvature. The spherical
 // lower bound only prunes candidates; final distances use WGS84 inverses.
 const candidates=segments.map(s=>{let d=Math.min(angle(p,s.av),angle(p,s.bv));const pn=dot(p,s.n),q=p.map((x,i)=>x-pn*s.n[i]),mag=norm(q);if(mag){const u=q.map(x=>x/mag);if(Math.abs(angle(s.av,u)+angle(u,s.bv)-s.ab)<1e-9)d=Math.min(d,angle(p,u));}return {s,lower:d*6335000-6378137*s.ab*s.ab-1};}).sort((a,b)=>a.lower-b.lower);
 for(const {s,lower} of candidates){
  // Curvature allowance above covers linear-GeoJSON vs great-circle edges.
  if(lower>best)break;
  const distance=(t:number)=>geod.Inverse(lat,lon,s.a[1]+t*(s.b[1]-s.a[1]),s.a[0]+t*(s.b[0]-s.a[0])).s12;
  best=Math.min(best,distance(0),distance(1));
  let lo=0,hi=1;
  for(let i=0;i<28;i++){const l=lo+(hi-lo)/3,r=hi-(hi-lo)/3;if(distance(l)<distance(r))hi=r;else lo=l;}
  best=Math.min(best,distance((lo+hi)/2));
 }
 return best/1609.344;
}
