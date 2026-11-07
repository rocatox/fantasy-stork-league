// Metadata only: no timeline/GPS archive downloads. Keep stale data on refresh errors.
export function createScoutProfileCache(fetcher=fetch,clock=Date.now){
 const entries=new Map(),queue=[];let active=0;
 function pump(){while(active<3&&queue.length){const job=queue.shift();active++;job().finally(()=>{active--;pump();});}}
 return {
  peek:id=>entries.get(id)?.data,
  load(id,revision='',force=false){
   let e=entries.get(id);
   if(e?.pending)return e.pending;
   if(!force&&e?.data&&e.revision===revision&&clock()-e.at<600000)return Promise.resolve(e.data);
   if(!e){e={};entries.set(id,e);}
   e.pending=new Promise((resolve,reject)=>{queue.push(async()=>{try{
    const r=await fetcher('/api/history?bird='+encodeURIComponent(id),{signal:AbortSignal.timeout(20000)});
    if(!r.ok)throw Error('History is temporarily unavailable.');const d=await r.json();
    if(!d.migration||!Array.isArray(d.migration.seasons)||!Array.isArray(d.years))throw Error('Invalid profile statistics');
    e.data=d;e.revision=revision;e.at=clock();resolve(d);
    if(entries.size>128)for(const [key,value] of entries){if(entries.size<=128)break;if(key!==id&&!value.pending)entries.delete(key);}
   }catch(error){reject(error);}finally{e.pending=null;}});});
   const pending=e.pending;pump();return pending;
  }
 };
}
export const scoutProfileCache=createScoutProfileCache();

// A background refresh may change values, but not the user's established order.
export function stableScoutOrder(previous,key,birds){
 const ids=birds.map(b=>b.id);
 if(previous?.key!==key)return {key,ids};
 const available=new Set(ids),known=new Set(previous.ids);
 return {key,ids:[...previous.ids.filter(id=>available.has(id)),...ids.filter(id=>!known.has(id))]};
}
