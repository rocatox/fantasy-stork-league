import {useEffect,useMemo,useState} from 'react';
import MigrationMap from './MigrationMap';
import {loadTimeline} from '../lib/timeline-cache.mjs';
import {windowPoints} from '../lib/league-trails.mjs';
export default function RecentMigrationMap({now,...props}:any){
 const {birds}=props;
 const [histories,setHistories]=useState<Record<string,any[]>>({}),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0);
 const key=birds.map((b:any)=>b.id).sort().join('|'),refresh=Math.floor(now/600000);
 useEffect(()=>{
  let active=true;const queue=[...birds];setFailed(false);
  async function worker(){while(queue.length&&active){const bird=queue.shift();try{const data=await loadTimeline(bird.id);const points=windowPoints([...data.points,[bird.longitude,bird.latitude,bird.latestValidFixUtc]],now-30*86400000,now);if(active)setHistories(h=>({...h,[bird.id]:points}));}catch{if(active)setFailed(true);}}}
  void Promise.all(Array.from({length:Math.min(4,queue.length)},worker));
  return()=>{active=false;};
 },[key,refresh,retry]);
 // Always rolling 30 days, independent of the racing calendar. Screen before clipping.
 const tracks=useMemo(()=>birds.map((bird:any)=>({bird,points:(histories[bird.id]||[]).filter(p=>Date.parse(p[2])>=now-30*86400000&&Date.parse(p[2])<=now)})),[birds,histories,now]);
 return <><MigrationMap {...props} backgroundTracks={tracks}/>{failed&&<div className="league-trail-status" role="status">Some recent trails could not load.<button onClick={()=>setRetry(v=>v+1)}>Retry trails</button></div>}</>;
}
