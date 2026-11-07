export function createTimelineCache(fetcher=fetch,now=()=>Date.now()){
 const entries=new Map();
 return function load(id,start=null,end=null,revision=''){
  const key=(start===null?id:id+':'+start+':'+end)+':'+revision;
  const cached=entries.get(key);
  if(cached&&now()-cached.created<10*60000){entries.delete(key);entries.set(key,cached);return cached.promise;}
  const entry={created:now(),promise:null};
  entry.promise=fetcher('/api/history?bird='+encodeURIComponent(id)+'&timeline=1'+(start===null?'':'&start='+start+'&end='+end)).then(async r=>{if(!r.ok)throw Error('Could not load the migration timeline.');return r.json();}).then(d=>{if(!Array.isArray(d.points))throw Error('Invalid migration history');return d;}).catch(e=>{if(entries.get(key)===entry)entries.delete(key);throw e;});
  entries.set(key,entry);while(entries.size>64)entries.delete(entries.keys().next().value);
  return entry.promise;
 };
}
export const loadTimeline=createTimelineCache();
export const prefetchTimeline=id=>{loadTimeline(id).catch(()=>{});};
