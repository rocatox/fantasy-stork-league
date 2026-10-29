import {membershipYear,entryOpen} from '../../../lib/league-membership.mjs';
import {birdRecord} from '../../../lib/bird-lifecycle.mjs';
import boundary from '../../../data/boundary-source.json';
import {addStandings} from '../../../lib/standings';
import {nameLeagues} from '../../../lib/profiles';
import {getUser} from '../../../lib/auth';
import {database,getBirds,json,safeWrite} from '../../../lib/store';
import {eligible,teamSize,turn,cutoff} from '../../../lib/rules.mjs';
import {disbandExpired} from '../../../lib/disband';
export const dynamic='force-dynamic';
export async function GET(req:Request){const u=await getUser(req);if(!u)return json({leagues:[],signedIn:false});await disbandExpired();const rows=await database().prepare('SELECT state FROM leagues').all();const own=rows.results.map((r:any)=>JSON.parse(r.state)).filter((l:any)=>l.members.some((m:any)=>m.id===u.userId));return json({signedIn:true,userId:u.userId,leagues:await addStandings(await nameLeagues(own))});}
export async function POST(req:Request){
 if(!safeWrite(req))return json({error:'Same-origin JSON required'},403);
 const u=await getUser(req,true);if(!u)return json({error:'Sign in to manage leagues'},401);
 let b:any;try{b=await req.json();}catch{return json({error:'Invalid request'},400);}
 if(!b||typeof b!=='object'||Array.isArray(b)||typeof b.action!=='string')return json({error:'Invalid request'},400);
 const db=database();const now=Date.now();
 await disbandExpired(now);
 const entering=b.action==='create'||b.action==='join';
 if(entering&&!entryOpen(now))return json({error:'Creating and joining leagues opens after June 30 Eastern'},409);
 const year=membershipYear(now),seasonStart=cutoff(year)/1000,seasonEnd=Date.parse(`${year}-07-01T04:00:00Z`)/1000;
 const membershipGuard="(SELECT COUNT(*) FROM leagues AS owned WHERE json_extract(owned.state,'$.status')!='disbanded' AND CAST(json_extract(owned.state,'$.year') AS INTEGER)>=? AND EXISTS (SELECT 1 FROM json_each(owned.state,'$.members') AS member WHERE json_extract(member.value,'$.id')=?))<6";
 const entryGuard=membershipGuard+" AND (unixepoch('now')<? OR unixepoch('now')>=?)";
 if(b.action==='create'){
  const name=String(b.name||'').trim().slice(0,60),displayName=u.displayName;
  if(!name)return json({error:'Enter a league name'},400);if(!displayName)return json({error:'Set a username of 15 characters or fewer through your account avatar before creating a league'},400);

  const id=crypto.randomUUID(),invite=crypto.randomUUID().replaceAll('-','');const y=new Date().getUTCFullYear();
  const s={id,name,owner:u.userId,invite,year:y+(now>=cutoff(y)?1:0),status:'lobby',members:[{id:u.userId,name:displayName}],picks:[],size:0,createdAt:new Date().toISOString()};
  const created=await db.prepare(`INSERT INTO leagues(id,invite,state) SELECT ?,?,? WHERE ${entryGuard}`).bind(id,invite,JSON.stringify(s),year,u.userId,seasonStart,seasonEnd).run();if(!created.meta.changes)return json({error:'You can belong to at most 6 active leagues; creating and joining is closed during the season'},409);return json({league:(await nameLeagues([s]))[0]});
 }
 const row=await db.prepare(b.action==='join'?'SELECT * FROM leagues WHERE invite=?':'SELECT * FROM leagues WHERE id=?').bind(String(b.action==='join'?b.invite:b.id).trim()).first();
 if(!row)return json({error:'League unavailable'},404);const s=JSON.parse(row.state);const member=s.members.find((m:any)=>m.id===u.userId);
 if(s.status==='disbanded')return json({error:'League disbanded: its draft was unfinished at the January 15 deadline'},409);
 if(b.action==='join'){
  if(member)return json({league:(await nameLeagues([s]))[0]});if(s.status!=='lobby'||s.members.length>=8)return json({error:'League is full or draft has started'},409);
  const name=u.displayName;if(!name)return json({error:'Set a username of 15 characters or fewer through your account avatar before joining a league'},400);s.members.push({id:u.userId,name});
 }else{
  if(!member)return json({error:'League unavailable'},404);
  if(b.action==='rotateInvite'){if(s.owner!==u.userId)return json({error:'Owner only'},403);s.invite=crypto.randomUUID().replaceAll('-','');}
  else if(b.action==='start'){
   if(s.owner!==u.userId||s.status!=='lobby'||s.members.length<2)return json({error:'Owner may start with at least 2 players'},409);
   if(now>=cutoff(s.year))return json({error:'January 15 deadline has passed'},409);
   s.size=teamSize((await getBirds()).filter((b:any)=>eligible(b,now)).length,s.members.length);if(s.size<1)return json({error:'Not enough eligible birds'},409);
   for(let i=s.members.length-1;i>0;i--){const a=new Uint32Array(1);crypto.getRandomValues(a);const j=a[0]%(i+1);[s.members[i],s.members[j]]=[s.members[j],s.members[i]];}
   s.status='draft';s.raceRulesVersion=1;s.raceBoundaryVersion=boundary.version;
  }else if(b.action==='pick'||b.action==='replace'){
   const replacing=b.action==='replace';
   const original=replacing?s.picks.find((p:any)=>p.birdId===b.originalBirdId&&p.userId===u.userId):null;
   if(replacing&&(!original?.replacementRequired||!['draft','ready'].includes(s.status)))return json({error:'This pick is not available for replacement'},409);
   if((!replacing&&s.status!=='draft')||now>=cutoff(s.year))return json({error:'Draft is closed'},409);
   if(!replacing&&s.members[turn(s.picks.length,s.members.length)].id!==u.userId)return json({error:'It is another playerâ€™s turn'},409);
   const bird=(await getBirds()).find((x:any)=>x.id===b.birdId);
   if(!bird||!eligible(bird,now)||s.picks.some((p:any)=>p.birdId===bird.id))return json({error:'Bird is not available or eligible'},409);
   if(bird.boundaryVersion!==boundary.version)return json({error:'Waiting for the updated boundary check; retry after the next sync'},409);
   const metadataRow=await db.prepare('SELECT payload FROM sync_state WHERE id=?').bind('metadata:'+bird.studyId).first();
   const animal=metadataRow?JSON.parse(metadataRow.payload).individuals.find((a:any)=>a.local_identifier===bird.name):null;
   if(!animal?.id)return json({error:'Bird identity has not been verified; wait for the next discovery sync'},409);
   const pick={bird:birdRecord(bird),birdId:bird.id,individualId:String(animal.id),userId:u.userId,pickedAt:new Date(now).toISOString(),observationAt:bird.latestValidFixUtc};
   if(replacing){s.replacements=[...(s.replacements||[]),{original,replacementBirdId:bird.id,replacedAt:new Date(now).toISOString()}];s.picks[s.picks.indexOf(original)]=pick;}
   else s.picks.push(pick);
   if(s.status==='draft'&&s.picks.length===s.members.length*s.size){s.status='ready';s.draftCompletedAt=new Date(now).toISOString();}
  }else return json({error:'Unknown action'},400);
 }
 // Async bird/identity reads may cross midnight; never commit that late pick.
 const unfinished=['lobby','draft'].includes(JSON.parse(row.state).status);
 const deadlineGuard=unfinished||b.action==='replace';
 if(deadlineGuard&&Date.now()>=cutoff(s.year)){
  await disbandExpired();return json({error:unfinished?'League disbanded: its draft was unfinished at the January 15 deadline':'Replacement window is closed'},409);
 }
 const update=await db.prepare("UPDATE leagues SET state=?,invite=?,revision=revision+1 WHERE id=? AND revision=? AND (?=0 OR unixepoch('now')<?)"+(b.action==='join'?` AND ${entryGuard}`:'')).bind(JSON.stringify(s),s.invite,s.id,row.revision,deadlineGuard?1:0,cutoff(s.year)/1000,...(b.action==='join'?[year,u.userId,seasonStart,seasonEnd]:[])).run();
 if(!update.meta.changes){await disbandExpired();return json({error:b.action==='join'?'Unable to join: limit of 6 active leagues, season closed, or league changed. Refresh and try again.':'League changed or its draft deadline passed. Refresh and try again.'},409);}return json({league:(await nameLeagues([s]))[0]});
}
