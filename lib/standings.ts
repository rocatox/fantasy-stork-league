import {standings} from './race.mjs';
import {database} from './store';
export async function addStandings(leagues:any[]){
 if(!leagues.length)return leagues;
 const db=database();const results:any[]=[];
 for(const year of new Set(leagues.map(l=>l.year))){const rows=await db.prepare('SELECT payload FROM race_results WHERE year=?').bind(year).all();results.push(...rows.results.map((r:any)=>JSON.parse(r.payload)));}
 return leagues.map(l=>({...l,standings:standings(l,results)}));
}
