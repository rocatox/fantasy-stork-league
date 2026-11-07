import {database} from './store';
import {cutoff,DAY} from './rules.mjs';
import {birdStatus} from './bird-lifecycle.mjs';

// Persist the replacement right before off-season cleanup removes the live bird.
// Recovery clears the replacement alert; the flag never disqualifies race evidence.
export async function refreshReplacements(now=Date.now()){
 const db=database(),birds=(await db.prepare('SELECT payload FROM birds').all()).results.map((r:any)=>JSON.parse(r.payload));
 const rows=await db.prepare("SELECT id,state FROM leagues WHERE json_extract(state,'$.status') IN ('draft','ready')").all();
 for(const row of rows.results){
  const league=JSON.parse(row.state),start=cutoff(league.year);let changed=false;
  for(const pick of league.picks){
   if(!Number.isFinite(Date.parse(pick.pickedAt))||Date.parse(pick.pickedAt)>=start)continue;
   const bird=birds.find(b=>b.id===pick.birdId);
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
