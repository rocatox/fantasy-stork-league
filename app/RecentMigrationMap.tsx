import {mapPriority} from '../lib/map-priority.mjs';
import {prepareTrail} from '../lib/prepared-trail.mjs';
import {useEffect,useMemo,useState} from 'react';
import MigrationMap from './MigrationMap';
import {loadRecentTrail} from '../lib/trail-loader';
const NO_TRACKS:any[]=[];
export default function RecentMigrationMap({now,...props}:any){
 const {birds}=props;
 const [histories,setHistories]=useState<Record<string,any>>({}),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0);
 const key=birds.map((b:any)=>b.id).sort().join('|'),refresh=Math.floor(now/600000);
 useEffect(()=>{
  let active=true;const controller=new AbortController();setFailed(false);
  let pending:Record<string,any>={},flushing=false;
  const flush=async()=>{try{await new Promise(r=>setTimeout(r,100));await mapPriority.wait(controller.signal);if(active){const batch=pending;pending={};setHistories(h=>({...h,...batch}));}}catch{}finally{flushing=false;}};
  const enqueue=(id:string,trail:any)=>{pending[id]=trail;if(!flushing){flushing=true;void flush();}};
  const start=refresh*600000-30*86400000,end=refresh*600000;
  async function pass(batch:any[],detail:boolean){
   const queue=[...batch];
   async function worker(){while(queue.length&&active){const bird=queue.shift();try{const prepared=await loadRecentTrail(bird,start,end,detail,controller.signal);if(active)enqueue(bird.id,prepared);}catch(e:any){if(active&&e.name!=='AbortError')setFailed(true);}}}
   await Promise.all(Array.from({length:Math.min(3,queue.length)},worker));
  }
  // Bounded cohorts retain their cached response through preview + detail,
  // instead of evicting early birds before the detail pass on large rosters.
  void (async()=>{for(let i=0;i<birds.length&&active;i+=12){const batch=birds.slice(i,i+12);await pass(batch,false);if(active)await pass(batch,true);}})();
  return()=>{active=false;controller.abort();};
 },[key,refresh,retry]);
 // Always rolling 30 days, independent of the racing calendar. Screen before clipping.
 const tracks=useMemo(()=>birds.map((bird:any)=>({bird,...(histories[bird.id]||prepareTrail([]))})),[birds,histories]);
 return <><MigrationMap {...props} backgroundTracks={props.trail?.id?NO_TRACKS:tracks}/>{failed&&<div className="league-trail-status" role="status">Some recent trails could not load.<button onClick={()=>setRetry(v=>v+1)}>Retry trails</button></div>}</>;
}
