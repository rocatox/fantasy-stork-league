import {clerkClient} from './clerk-client';
import {playerUsername} from './usernames.mjs';
import {profileCache} from './profile-cache.mjs';
const profiles=profileCache(async(ids:string[])=>{
 const result=new Map<string,any>();
 for(let i=0;i<ids.length;i+=100){const users=await clerkClient().users.getUserList({userId:ids.slice(i,i+100),limit:100});for(const user of users.data)result.set(user.id,{name:playerUsername(user)||'Player (username pending)',imageUrl:user.imageUrl||null});}
 return result;
});
export async function nameLeagues(leagues:any[]){
 const ids:string[]=[...new Set<string>(leagues.flatMap(l=>l.members.map((m:any)=>m.id)))];
 if(!ids.length)return leagues;
 const people=await profiles(ids);
 return leagues.map(l=>({...l,members:l.members.map((m:any)=>({...m,...people.get(m.id)}))}));
}
