import {database} from './store';
import {cutoff,DAY} from './rules.mjs';
import {birdStatus} from './bird-lifecycle.mjs';

// Persist the replacement right before off-season cleanup removes the live bird.
// Recovery clears the replacement alert; the flag never disqualifies race evidence.
export async function refreshReplacements(now=Date.now(),userId?:string,birdId?:string){
 const db=database();
 // Race claims inspect one bird. Healthy birds with no replacement flag need
 // no league JSON returned; dormant/deceased birds still get the original rules.
 const fields="id,json_extract(payload,'$.latestValidFixUtc') AS latestValidFixUtc,json_extract(payload,'$.recordedDead') AS recordedDead";
 const one=birdId?await db.prepare('SELECT '+fields+' FROM birds WHERE id=?').bind(birdId).first():null;
 if(birdId&&!one)return;
 const bird=one;
 const args:any[]=[];
 let scope='';
 if(userId){scope+=" AND EXISTS (SELECT 1 FROM json_each(leagues.state,'$.members') WHERE json_extract(value,'$.id')=?)";args.push(userId);}
 if(birdId){scope+=" AND EXISTS (SELECT 1 FROM json_each(leagues.state,'$.picks') WHERE json_extract(value,'$.birdId')=? AND (json_extract(value,'$.replacementRequired') IS NOT NULL OR ?!='active'))";args.push(birdId,birdStatus(bird,now));}
 const query=db.prepare("SELECT id,state FROM leagues WHERE json_extract(state,'$.status') IN ('draft','ready')"+scope);
 const rows=await (args.length?query.bind(...args):query).all();
 if(!rows.results.length)return;
 const loaded=rows.results.map((row:any)=>({row,league:JSON.parse(row.state)}));
 const birds=new Map<string,any>(bird?[[birdId!,bird]]:[]);
 if(!bird){
  const ids=[...new Set<string>(loaded.flatMap(({league}:any)=>league.picks.map((p:any)=>p.birdId)))];
  for(let i=0;i<ids.length;i+=90){const part=ids.slice(i,i+90);
   const found=await db.prepare('SELECT '+fields+' FROM birds WHERE id IN ('+part.map(()=>'?').join(',')+')').bind(...part).all();
   for(const b of found.results)birds.set(b.id,b);
  }
 }
 for(const {row,league} of loaded){
  const start=cutoff(league.year);let changed=false;
  for(const pick of league.picks){
   if(!Number.isFinite(Date.parse(pick.pickedAt))||Date.parse(pick.pickedAt)>=start)continue;
   const bird=birds.get(pick.birdId);
   if(!bird)continue;
   const status=birdStatus(bird,now);
   if(status==='active'&&pick.replacementRequired){delete pick.replacementRequired;changed=true;}
   if(pick.replacementRequired)continue;
   // A gap already over 30 days at the deadline can be recognized by the first
   // post-deadline job. Death first reported after the start is not backdated.
   const inactiveBeforeStart=Date.parse(bird.latestValidFixUtc)+30*DAY<start&&status==='inactive';
   if((now<start&&status!=='active')||(now>=start&&inactiveBeforeStart)){
    pick.replacementRequired={reason:status,detectedAt:new Date(now).toISOString()};changed=true;
   }
  }
  if(changed){const result=await db.prepare('UPDATE leagues SET state=?,revision=revision+1 WHERE id=? AND state=?').bind(JSON.stringify(league),row.id,row.state).run();if(!result.meta.changes)throw Error('League changed during replacement checks; retry');}
 }
}
