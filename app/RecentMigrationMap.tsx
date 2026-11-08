import {mapPriority} from '../lib/map-priority.mjs';
import {prepareTrail} from '../lib/prepared-trail.mjs';
import {useEffect,useMemo,useState} from 'react';
import MigrationMap from './MigrationMap';
import {loadRecentTrail} from '../lib/trail-loader';
const NO_TRACKS:any[]=[];
export function useRecentTrails(birds:any[],now:number,revision:string){
 const [histories,setHistories]=useState<Record<string,any>>({}),[loading,setLoading]=useState(false),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0);
 const key=birds.map((b:any)=>b.id+':'+b.latestValidFixUtc).sort().join('|'),refresh=Math.floor(now/600000);
 useEffect(()=>{
  let active=true;const ids=new Set(birds.map(b=>b.id));setHistories(h=>Object.fromEntries(Object.entries(h).filter(([id])=>ids.has(id))));const controller=new AbortController();setFailed(false);setLoading(birds.length>0);
  let pending:Record<string,any>={},flushing:Promise<void>|null=null;
  const flush=async()=>{try{await new Promise(r=>setTimeout(r,100));await mapPriority.wait(controller.signal);if(active){const batch=pending;pending={};setHistories(h=>({...h,...batch}));}}catch{}finally{flushing=null;}};
  const enqueue=(id:string,trail:any)=>{pending[id]=trail;if(!flushing)flushing=flush();};
  const start=refresh*600000-30*86400000,end=refresh*600000;
  async function pass(batch:any[],detail:boolean){
   const queue=[...batch];
   async function worker(){while(queue.length&&active){const bird=queue.shift();try{const prepared=await loadRecentTrail({...bird,revision},start,end,detail,controller.signal);if(active)enqueue(bird.id,prepared);}catch(e:any){if(active&&e.name!=='AbortError')setFailed(true);}}}
   await Promise.all(Array.from({length:Math.min(3,queue.length)},worker));
  }
  // Bounded cohorts retain their cached response through preview + detail,
  // instead of evicting early birds before the detail pass on large rosters.
  void (async()=>{for(let i=0;i<birds.length&&active;i+=12){const batch=birds.slice(i,i+12);await pass(batch,false);if(active)await pass(batch,true);}await flushing;if(active)setLoading(false);})();
  return()=>{active=false;controller.abort();};
 },[key,refresh,retry,revision]);
 return {histories,loading,failed,retry:()=>setRetry(v=>v+1)};
}
export default function RecentMigrationMap({recent,...props}:any){
 const {birds}=props;const {histories,loading,failed,retry}=recent;
 // Always rolling 30 days, independent of the racing calendar. Screen before clipping.
 const tracks=useMemo(()=>birds.map((bird:any)=>({bird,...(histories[bird.id]||prepareTrail([]))})),[birds,histories]);
 return <MigrationMap {...props} backgroundTracks={props.trail?.id?NO_TRACKS:tracks} backgroundStatus={loading?'Loading 30-day trails…':failed?'Some recent trails could not load.':''} backgroundFailed={failed&&!loading} onRetryBackground={retry}/>;
}
