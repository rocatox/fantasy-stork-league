import {env} from 'cloudflare:workers';
import {createClerkClient} from '@clerk/backend';
import {playerUsername} from './usernames.mjs';
export async function nameLeagues(leagues:any[]){const ids:string[]=[...new Set<string>(leagues.flatMap(l=>l.members.map((m:any)=>m.id)))];if(!ids.length)return leagues;const client=createClerkClient({secretKey:(env as any).CLERK_SECRET_KEY});const names=new Map<string,string>();for(let i=0;i<ids.length;i+=100){const result=await client.users.getUserList({userId:ids.slice(i,i+100),limit:100});for(const user of result.data)names.set(user.id,playerUsername(user));}return leagues.map(l=>({...l,members:l.members.map((m:any)=>({...m,name:names.get(m.id)||'Player (username pending)'}))}));}
