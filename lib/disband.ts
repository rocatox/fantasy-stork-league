import {database} from './store';
import {shouldDisband} from './sync-policy.mjs';
export async function disbandExpired(now=Date.now()) {
 const db=database();const rows=await db.prepare("SELECT id,state,revision FROM leagues WHERE json_extract(state,'$.status') IN ('lobby','draft')").all();let count=0;
 for(const row of rows.results){const league=JSON.parse(row.state);if(!shouldDisband(league,now))continue;league.status='disbanded';league.disbandedAt=new Date(now).toISOString();league.disbandReason='Draft not completed by January 15 Eastern';league.invite=crypto.randomUUID().replaceAll('-','');
 const result=await db.prepare('UPDATE leagues SET state=?,invite=?,revision=revision+1 WHERE id=? AND revision=?').bind(JSON.stringify(league),league.invite,row.id,row.revision).run();count+=result.meta.changes||0;}return count;
}
