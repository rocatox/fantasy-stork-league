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
  const start=refresh*600000-30*86400000,end=refresh*600000;
  async function pass(detail:boolean){
   const queue=[...birds];
   async function worker(){while(queue.length&&active){const bird=queue.shift();try{const prepared=await loadRecentTrail(bird,start,end,detail,controller.signal);if(active)setHistories(h=>({...h,[bird.id]:prepared}));}catch(e:any){if(active&&e.name!=='AbortError')setFailed(true);}}}
   await Promise.all(Array.from({length:Math.min(3,queue.length)},worker));
  }
  void pass(false).then(()=>{if(active)return pass(true);});
  return()=>{active=false;controller.abort();};
 },[key,refresh,retry]);
 // Always rolling 30 days, independent of the racing calendar. Screen before clipping.
 const tracks=useMemo(()=>birds.map((bird:any)=>({bird,...(histories[bird.id]||prepareTrail([]))})),[birds,histories]);
 return <><MigrationMap {...props} backgroundTracks={props.trail?.id?NO_TRACKS:tracks}/>{failed&&<div className="league-trail-status" role="status">Some recent trails could not load.<button onClick={()=>setRetry(v=>v+1)}>Retry trails</button></div>}</>;
}
