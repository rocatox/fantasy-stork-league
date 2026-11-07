// Display-only cache. Never stores sessions, permissions, league state or email.
export function profileCache(load,{now=Date.now,ttl=60000,limit=512}={}){
 const entries=new Map();
 return async ids=>{
  const time=now(),missing=ids.filter(id=>!entries.has(id)||entries.get(id).expires<=time);
  const result=new Map(ids.filter(id=>!missing.includes(id)).map(id=>[id,entries.get(id).profile]));
  if(missing.length){
   const profiles=await load(missing);
   for(const id of missing){const profile=profiles.get(id)||{name:'Player (username pending)',imageUrl:null};result.set(id,profile);entries.delete(id);entries.set(id,{profile,expires:time+ttl});}
   while(entries.size>limit)entries.delete(entries.keys().next().value);
  }
  return result;
 };
}
