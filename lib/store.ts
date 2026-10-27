import {env} from 'cloudflare:workers';
import seed from '../data/seed.json';
export const database=()=>{const db=(env as any).DB;if(!db)throw new Error('Database unavailable');return db;};
export async function getBirds(){const r=await database().prepare('SELECT payload FROM birds').all();const merged=new Map(seed.birds.map(b=>[b.id,b]));for(const row of r.results) {const b=JSON.parse(row.payload);merged.set(b.id,b);}return [...merged.values()];}
export function json(data:any,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store'}});}
export function safeWrite(req:Request){return req.headers.get('origin')===new URL(req.url).origin&&req.headers.get('content-type')?.includes('application/json');}
