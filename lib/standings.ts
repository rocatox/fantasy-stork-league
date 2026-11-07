import {standings} from './race.mjs';
import {database} from './store';
export async function addStandings(leagues:any[]){
 if(!leagues.length)return leagues;
 const db=database();const results:any[]=[];
 for(const year of new Set(leagues.map(l=>l.year))){
  const ids=[...new Set<string>(leagues.filter(l=>l.year===year).flatMap(l=>(l.picks||[]).map((p:any)=>p.birdId)))];
  // Bound parameters stay below D1's 100 limit, including oversized traded rosters.
  for(let i=0;i<ids.length;i+=90){const part=ids.slice(i,i+90);
   const rows=await db.prepare(`SELECT payload FROM race_results WHERE year=? AND bird_id IN (${part.map(()=>'?').join(',')})`).bind(year,...part).all();
   results.push(...rows.results.map((r:any)=>JSON.parse(r.payload)));
  }
 }
 return leagues.map(l=>({...l,standings:standings(l,results)}));
}
