import geometry from '../data/germany.json';
import overview from '../data/map.json';
const rad=Math.PI/180,vec=(p:number[])=>[Math.cos(p[1]*rad)*Math.cos(p[0]*rad),Math.cos(p[1]*rad)*Math.sin(p[0]*rad),Math.sin(p[1]*rad)];
const dot=(a:number[],b:number[])=>a.reduce((s,x,i)=>s+x*b[i],0),cross=(a:number[],b:number[])=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm=(v:number[])=>Math.sqrt(dot(v,v)),angle=(a:number[],b:number[])=>Math.atan2(norm(cross(a,b)),dot(a,b));
const polygons:any[]=geometry.type==='MultiPolygon'?geometry.coordinates:[geometry.coordinates];
const segments=polygons.flatMap(p=>p.flatMap((r:number[][])=>r.slice(1).map((end,i)=>{const a=vec(r[i]),b=vec(end),v=cross(a,b),n=norm(v);return {a,b,n:v.map(x=>x/n),ab:angle(a,b)};})));
function inRing(lon:number,lat:number,r:number[][]){let inside=false;for(let i=0,j=r.length-1;i<r.length;j=i++){if((r[i][1]>lat)!==(r[j][1]>lat)&&lon<(r[j][0]-r[i][0])*(lat-r[i][1])/(r[j][1]-r[i][1])+r[i][0])inside=!inside;}return inside;}
export function inGermany(lon:number,lat:number){return polygons.some(p=>inRing(lon,lat,p[0])&&!p.slice(1).some((r:number[][])=>inRing(lon,lat,r)));}
export function countryLabel(lon:number,lat:number){if(inGermany(lon,lat))return {code:'DE',name:'Germany'};const c=overview.find(c=>c.rings.some(r=>inRing(lon,lat,r)));return c?{code:c.code,name:c.name}:{code:null,name:'See coordinates'};}
export function distanceMiles(lon:number,lat:number){if(inGermany(lon,lat))return 0;const p=vec([lon,lat]);let best=Math.PI;for(const {a,b,n,ab} of segments){best=Math.min(best,angle(p,a),angle(p,b));const pn=dot(p,n),q=p.map((x,i)=>x-pn*n[i]),mag=norm(q);if(!mag)continue;const u=q.map(x=>x/mag);if(Math.abs(angle(a,u)+angle(u,b)-ab)<1e-9)best=Math.min(best,angle(p,u));}return best*6371.0088/1.609344;}
