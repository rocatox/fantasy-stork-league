import {useEffect,useMemo,useState} from 'react';
import MigrationMap from './MigrationMap';
import {loadTimeline} from '../lib/timeline-cache.mjs';
import {leagueWindow,windowPoints} from '../lib/league-trails.mjs';
export default function LeagueMap({birds,selected,color,onBird,now}:any){
 const [histories,setHistories]=useState<Record<string,any[]>>({}),[loading,setLoading]=useState(false),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0);
 const key=birds.map((b:any)=>b.id).sort().join('|'),refresh=Math.floor(now/600000);
 useEffect(()=>{
  let active=true;const queue=[...birds];setLoading(true);setFailed(false);
  async function worker(){while(queue.length&&active){const b=queue.shift();try{const data=await loadTimeline(b.id);if(active)setHistories(h=>({...h,[b.id]:data.points}));}catch{if(active)setFailed(true);}}}
  Promise.all(Array.from({length:Math.min(4,queue.length)},worker)).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[key,refresh,retry]);
 const window=useMemo(()=>leagueWindow(now),[now]);
 const tracks=useMemo(()=>birds.filter((b:any)=>!selected||b.id===selected.id).map((bird:any)=>({bird,points:windowPoints([...(histories[bird.id]||[]),[bird.longitude,bird.latitude,bird.latestValidFixUtc]],window.start,window.end)})),[key,selected?.id,histories,window]);
 return <MigrationMap birds={birds} trail={selected?{...selected,replay:true}:null} color={color} onBird={onBird} replayStatus={loading?'Loading team trails…':failed?'Could not load some team trails.':'No observations in this window.'} onRetry={()=>setRetry(v=>v+1)} league leagueTracks={tracks} leagueWindow={window} leagueLoading={loading} leagueFailed={failed}/>;
}
