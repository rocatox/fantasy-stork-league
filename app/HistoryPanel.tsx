import {useEffect,useState} from 'react';
export default function HistoryPanel({bird,onExplore}:{bird:any,onExplore:(points:any[])=>void}){
 const [info,setInfo]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;setInfo(null);setError('');
  fetch('/api/history?bird='+encodeURIComponent(bird.id)).then(async r=>{if(!r.ok)throw Error('History is temporarily unavailable.');return r.json();}).then((d:any)=>{if(active){setInfo(d);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};
 },[bird.id]);
 async function explore(){setBusy(true);setError('');try{const r=await fetch('/api/history?bird='+encodeURIComponent(bird.id)+'&timeline=1');if(!r.ok)throw Error('Could not load this trail. Please retry.');const d:any=await r.json();if(!d.points?.length)throw Error('No valid positions are available to replay yet.');onExplore(d.points);}catch(e:any){setError(e.message);}finally{setBusy(false);}}
 return <section aria-label="Migration history"><h3>Migration history</h3>{error&&<p role="alert">{error}</p>}{!info&&!error&&<p>Fetching the scouting tape…</p>}{info&&<>
  <p>{info.records?`${info.years.length} years of recorded movement to scout`:'Historical import pending.'}</p>
  {info.records>0&&!info.state?.complete&&<p>Backfill in progress; coverage is incomplete.</p>}

  {!!info.years.length&&<button className="primary" disabled={busy} onClick={explore}>{busy?'Loading the full timeline…':'Replay migration history ↗'}</button>}
  <p>Drag through this bird’s recorded journey on the map, across every available year.</p>
 </>}</section>;
}
