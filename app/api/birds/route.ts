import {assignPortraits} from '../../../lib/bird-portraits.mjs';
import {env} from 'cloudflare:workers';
import {getBirds,json,database} from '../../../lib/store';
import seed from '../../../data/seed.json';
import {syncPolicy} from '../../../lib/sync-policy.mjs';
export const dynamic='force-dynamic';
export async function GET(){try{const db=database();const birds=await assignPortraits(db,await getBirds());const runs=await db.prepare('SELECT payload FROM sync_runs ORDER BY id DESC LIMIT 8').all();const states=await db.prepare("SELECT id,payload FROM sync_state WHERE id LIKE 'study:%' OR id='schedules'").all();const sources=states.results.filter((r:any)=>r.id.startsWith('study:')).map((r:any)=>({studyId:r.id.slice(6),...JSON.parse(r.payload)}));const policy=syncPolicy();const overdueStudies=seed.studies.filter(study=>{const source=sources.find((s:any)=>s.studyId===study.studyId);return !source||Date.now()-Date.parse(source.lastSuccessAt)>(policy.intervalHours+1)*3600000;}).map(s=>s.studyId);const times=sources.map((s:any)=>s.lastSuccessAt).sort();return json({birds,asOf:times[0]||seed.asOf,runs:runs.results.map((r:any)=>JSON.parse(r.payload)),sources,syncActive:(env as any).SYNC_ENABLED==='true',policy,overdueStudies});}catch{return json({birds:[],asOf:seed.asOf,runs:[],sources:[],syncActive:false,notice:'Live data temporarily unavailable; please retry.'});}}
