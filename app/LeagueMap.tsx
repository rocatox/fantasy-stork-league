import {prepareTrail} from '../lib/prepared-trail.mjs';
import {useEffect,useMemo,useState} from 'react';
import MigrationMap from './MigrationMap';
import {loadWindowTrail,loadSelectedWindowTrail} from '../lib/trail-loader';
import {leagueWindow,windowPoints} from '../lib/league-trails.mjs';
export default function LeagueMap({birds,selected,color,onBird,now}:any){
 const [histories,setHistories]=useState<Record<string,any>>({}),[loading,setLoading]=useState(false),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0);
 const window=useMemo(()=>leagueWindow(now),[now]);
 const key=birds.map((b:any)=>b.id).sort().join('|'),refresh=Math.floor(now/600000);
 useEffect(()=>{
  let active=true;const controller=new AbortController();const queue=[...birds];setLoading(true);setFailed(false);
  async function worker(){while(queue.length&&active){const b=queue.shift();try{const prepared=await loadWindowTrail(b,window.start,window.end,controller.signal);if(active)setHistories(h=>({...h,[b.id]:prepared}));}catch{if(active)setFailed(true);}}}
  Promise.all(Array.from({length:Math.min(1,queue.length)},worker)).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;controller.abort();};
 },[key,refresh,retry]);
 // A selected bird bypasses the background queue, including during startup.
 useEffect(()=>{if(!selected||histories[selected.id])return;let active=true;loadSelectedWindowTrail(selected,window.start,window.end).then(prepared=>{if(active)setHistories(h=>({...h,[selected.id]:prepared}));}).catch(()=>{if(active)setFailed(true);});return()=>{active=false;};},[selected?.id,refresh]);
 const allTracks=useMemo(()=>birds.map((bird:any)=>({bird,...(histories[bird.id]||prepareTrail(windowPoints([[bird.longitude,bird.latitude,bird.latestValidFixUtc]],window.start,window.end)))})),[key,histories,window]);
 const tracks=useMemo(()=>selected?allTracks.filter((t:any)=>t.bird.id===selected.id):allTracks,[allTracks,selected?.id]);
 return <MigrationMap birds={birds} trail={selected?{...selected,replay:true}:null} color={color} onBird={onBird} replayStatus={loading?'Loading flock trails…':failed?'Could not load some flock trails.':'No observations in this window.'} onRetry={()=>setRetry(v=>v+1)} league leagueTracks={tracks} leagueWindow={window} leagueLoading={loading} leagueFailed={failed}/>;
}
