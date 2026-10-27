import {env} from 'cloudflare:workers';
import {getBirds,json,database} from '../../../lib/store';
import seed from '../../../data/seed.json';
import {syncPolicy} from '../../../lib/sync-policy.mjs';
export const dynamic='force-dynamic';
export async function GET(){try{const birds=await getBirds();const db=database();const runs=await db.prepare('SELECT payload FROM sync_runs ORDER BY id DESC LIMIT 8').all();const states=await db.prepare("SELECT id,payload FROM sync_state WHERE id LIKE 'study:%' OR id='schedules'").all();const schedule=states.results.find((r:any)=>r.id==='schedules');const sources=states.results.filter((r:any)=>r.id.startsWith('study:')).map((r:any)=>({studyId:r.id.slice(6),...JSON.parse(r.payload)}));const times=sources.map((s:any)=>s.lastSuccessAt).sort();return json({birds,asOf:times.at(-1)||seed.asOf,runs:runs.results.map((r:any)=>JSON.parse(r.payload)),sources,syncActive:(env as any).SYNC_ENABLED==='true',policy:syncPolicy()});}catch{return json({birds:seed.birds,asOf:seed.asOf,runs:[],sources:[],syncActive:false,notice:'Live data temporarily unavailable; showing the saved audit.'});}}
