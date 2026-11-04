import {syncPolicy} from './sync-policy.mjs';
const ROOT='https://api.github.com/repos/rocatox/fantasy-stork-league/actions/workflows/sync.yml';
const KEY='cloudflare-sync-timer';
const STUDIES=['10449318','212096177','173641633','864730855','4809963363','21231406','24442409','76367850'];
export function timerDecision({now,slot,sources,state,runs}){
 if(runs.some(r=>r.status!=='completed'))return 'running';
 if(state.lastDispatchAt&&now-Date.parse(state.lastDispatchAt)<30*60000)return 'cooldown';
 const due=STUDIES.some(id=>sources.find(s=>s.studyId===id)?.lastSuccessSlot!==slot);
 const latest=runs[0];
 const failed=latest&&latest.status==='completed'&&['failure','timed_out','cancelled','action_required'].includes(latest.conclusion)&&syncPolicy(Date.parse(latest.created_at)).slot===slot;
 if(!due&&!failed&&state.lastAcceptedAt)return 'current';
 if(state.slot===slot&&state.attempts>=3)return 'retry-limit';
 return 'dispatch';
}
export async function runSyncTimer(env,{now=Date.now(),fetcher=fetch}={}){
 const db=env.DB,lease=crypto.randomUUID(),checkedAt=new Date(now).toISOString();
 const lock=await db.prepare("INSERT INTO sync_state(id,payload) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=json_set(sync_state.payload,'$.lease',?,'$.leaseUntil',?) WHERE COALESCE(json_extract(sync_state.payload,'$.leaseUntil'),0)<?").bind(KEY,JSON.stringify({lease,leaseUntil:now+120000}),lease,now+120000,now).run();
 if(!lock.meta.changes)return {status:'locked'};
 let state=JSON.parse((await db.prepare('SELECT payload FROM sync_state WHERE id=?').bind(KEY).first()).payload);
 let stage='configuration';
 const save=async(status,extra={})=>{state={...state,...extra,status,lastCheckedAt:checkedAt,leaseUntil:0};await db.prepare("UPDATE sync_state SET payload=? WHERE id=? AND json_extract(payload,'$.lease')=?").bind(JSON.stringify(state),KEY,lease).run();return {status};};
 try{
  if(env.SYNC_ENABLED!=='true')return await save('disabled');
  if(!env.GITHUB_SYNC_TOKEN)return await save('token-required');
  const token=String(env.GITHUB_SYNC_TOKEN).trim();
  if(!/^github_pat_[A-Za-z0-9_]+$/.test(token))return await save('token-format-invalid');
  const headers={Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','User-Agent':'Fantasy-Stork-League-Sync-Timer','X-GitHub-Api-Version':'2022-11-28'};
  const api=async(path,options={})=>{const r=await fetcher(ROOT+path,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(15000),redirect:'error'});if(!r.ok)throw Error('github-http-'+r.status);return r;};
  stage='list-runs';
  const response=await api('/runs?branch=main&per_page=10');
  stage='decode-runs';
  const runs=(await response.json()).workflow_runs;
  if(!Array.isArray(runs))throw Error('github-response-invalid');
  stage='read-source-state';
  const rows=await db.prepare("SELECT id,payload FROM sync_state WHERE id LIKE 'study:%'").all();
  const sources=rows.results.map(r=>({studyId:r.id.slice(6),...JSON.parse(r.payload)}));
  stage='select-due-work';
  const slot=syncPolicy(now).slot;
  const decision=timerDecision({now,slot,sources,state,runs});
  if(decision!=='dispatch')return await save(decision);
  // Record the attempt before sending: an ambiguous network result must not cause rapid duplicates.
  const next={...state,slot,attempts:state.slot===slot?(state.attempts||0)+1:1,lastDispatchAt:checkedAt};
  await db.prepare("UPDATE sync_state SET payload=? WHERE id=? AND json_extract(payload,'$.lease')=?").bind(JSON.stringify(next),KEY,lease).run();state=next;
  stage='dispatch';
  await api('/dispatches',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ref:'main',inputs:{timer_triggered:true}})});
  return await save('dispatched',{lastAcceptedAt:checkedAt});
 }catch(e){const code=/^github-(http-\d+|response-invalid)$/.test(e.message)?e.message:'timer-request-failed';await save(code,{failureStage:stage,failureKind:['TypeError','TimeoutError','AbortError','SyntaxError'].includes(e.name)?e.name:'Error'});throw Error(code+' at '+stage);}
}
