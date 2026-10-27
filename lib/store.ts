import {env} from 'cloudflare:workers';
import {sameRing} from './sync-policy.mjs';
import {keepBird} from './bird-lifecycle.mjs';
export const database=()=>{const db=(env as any).DB;if(!db)throw new Error('Database unavailable');return db;};
export async function getBirds(){const r=await database().prepare('SELECT payload FROM birds').all();const all:any[]=r.results.map((row:any)=>JSON.parse(row.payload)).filter((b:any)=>keepBird(b));return all.map(b=>all.some(other=>other.id!==b.id&&sameRing(b.ringId,other.ringId))?{...b,duplicateRingReview:true,reviewRequired:true}:b);}
export function json(data:any,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store'}});}
export function safeWrite(req:Request){return req.headers.get('origin')===new URL(req.url).origin&&req.headers.get('content-type')?.includes('application/json');}
