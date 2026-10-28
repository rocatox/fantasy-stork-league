export function createTimelineCache(fetcher=fetch,now=()=>Date.now()){
 const entries=new Map();
 return function load(id){
  const cached=entries.get(id);
  if(cached&&now()-cached.created<10*60000){entries.delete(id);entries.set(id,cached);return cached.promise;}
  const entry={created:now(),promise:null};
  entry.promise=fetcher('/api/history?bird='+encodeURIComponent(id)+'&timeline=1').then(async r=>{if(!r.ok)throw Error('Could not load the migration timeline.');return r.json();}).then(d=>{if(!Array.isArray(d.points))throw Error('Invalid migration history');return d;}).catch(e=>{if(entries.get(id)===entry)entries.delete(id);throw e;});
  entries.set(id,entry);while(entries.size>8)entries.delete(entries.keys().next().value);
  return entry.promise;
 };
}
export const loadTimeline=createTimelineCache();
export const prefetchTimeline=id=>{loadTimeline(id).catch(()=>{});};
