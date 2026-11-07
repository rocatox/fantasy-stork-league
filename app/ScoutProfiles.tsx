import {useEffect,useRef,useState} from 'react';
import BirdProfile from './BirdProfile';
import {scoutProfileCache,stableScoutOrder} from '../lib/scout-profile-cache.mjs';
import {birdName} from '../lib/bird-name.mjs';
import './ScoutProfiles.css';

const placeholder={records:1,years:[],first:'2000-01-01',state:{complete:true},migration:{successes:0,attempts:0,typicalArrival:null,arrivalSpreadDays:null,pendingYears:0,seasons:[{attempt:true,year:2026}]}};
function ScoutCard({bird,now,revision,starred,onStar,onMap}:any){
 const ref=useRef<HTMLDivElement>(null),[near,setNear]=useState(false);
 const [info,setInfo]=useState<any>(()=>scoutProfileCache.peek(bird.id)),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{const observer=new IntersectionObserver(es=>{if(es.some(e=>e.isIntersecting)){setNear(true);observer.disconnect();}},{rootMargin:'400px'});if(ref.current)observer.observe(ref.current);return()=>observer.disconnect();},[]);
 useEffect(()=>{if(!near)return;let active=true;setError('');
  const portrait=bird.portraitId?new Promise<void>(resolve=>{const img=new Image();img.onload=()=>{img.decode().catch(()=>{}).finally(resolve);};img.onerror=()=>resolve();img.src='/stork-portraits/stork-'+String(bird.portraitId).padStart(2,'0')+'.webp';setTimeout(resolve,4000);}):Promise.resolve();
  Promise.all([scoutProfileCache.load(bird.id,revision,!!retry),portrait]).then(([d])=>{if(active)setInfo(d);}).catch(()=>{if(active)setError(info?'Could not refresh statistics. Showing saved data.':'Statistics are unavailable.');});
  return()=>{active=false;};
 },[bird.id,near,revision,retry]);
 const loading=!info&&!error;
 return <div ref={ref} className={'scout-card-slot'+(loading?' scout-card-loading':'')} data-bird-id={bird.id} aria-busy={loading}>
  <div className="scout-card-content" inert={loading} aria-hidden={loading||undefined}>
   <BirdProfile bird={bird} now={now} starred={starred} onStar={onStar} compact onMap={onMap} suppliedHistory={info||(error?{...placeholder,first:null}:placeholder)} historyUnavailable={!info&&!!error}/>
  </div>
  {loading&&<div className="scout-card-placeholder" role="status" aria-label={'Loading profile for '+birdName(bird.name)}><span className="skeleton-portrait"/><span className="skeleton-line"/><span className="skeleton-record"/><span className="skeleton-line"/><span className="skeleton-line"/><span className="scout-loading-label">Loading profile…</span></div>}
  <div className="scout-card-status" role="status">{error&&<>{error} <button onClick={()=>setRetry(n=>n+1)}>Retry</button></>}</div>
 </div>;
}
export default function ScoutProfiles({birds,now,revision,starred,onStar,onMap,orderKey,orderRef,waiting,loaded}:any){
 // Keep mounted/cached cards visible while ranking data for a requested sort arrives.
 const order=stableScoutOrder(orderRef.current,waiting&&orderRef.current?orderRef.current.key:orderKey,birds);if(!waiting)orderRef.current=order;
 const byId=new Map(birds.map((b:any)=>[b.id,b]));
 return <div className="scout-profiles">{order.ids.map((id:string)=><ScoutCard key={id} bird={byId.get(id)} now={now} revision={revision} starred={starred.includes(id)} onStar={()=>onStar(id)} onMap={onMap}/>)}{!birds.length&&<p className="empty">{loaded?'No storks match these filters.':'Loading storks…'}</p>}</div>;
}
