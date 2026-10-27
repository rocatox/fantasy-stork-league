import {useEffect,useState} from 'react';
export default function HistoryPanel({bird,onExplore}:{bird:any,onExplore:(points:any[],year:string)=>void}){
 const [info,setInfo]=useState<any>(null),[year,setYear]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;setInfo(null);setError('');setYear('');
  fetch('/api/history?bird='+encodeURIComponent(bird.id)).then(async r=>{if(!r.ok)throw Error('History is temporarily unavailable.');return r.json();}).then((d:any)=>{if(active){setInfo(d);setYear(d.years.at(-1)||'');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};
 },[bird.id]);
 async function explore(){setBusy(true);setError('');try{const r=await fetch('/api/history?bird='+encodeURIComponent(bird.id)+'&year='+year);if(!r.ok)throw Error('Could not load this trail. Please retry.');const d:any=await r.json();onExplore(d.points,year);}catch(e:any){setError(e.message);}finally{setBusy(false);}}
 return <section aria-label="Migration history"><h3>Migration history</h3>{error&&<p role="alert">{error}</p>}{!info&&!error&&<p>Loading archive…</p>}{info&&<>
  <p>{info.records?`${info.records.toLocaleString()} archived GPS records · ${info.valid.toLocaleString()} valid fixes`:'Historical import pending.'}</p>
  {info.first&&<p>{info.first.slice(0,10)} – {info.last.slice(0,10)}</p>}
  {info.records>0&&!info.state?.complete&&<p>Backfill in progress; coverage is incomplete.</p>}
  {info.state?.lastSuccessAt&&<p className="fine">History last synced: {new Date(info.state.lastSuccessAt).toLocaleString()}</p>}
  {!!info.years.length&&<><label>Migration year<select value={year} onChange={e=>setYear(e.target.value)}>{info.years.map((y:string)=><option key={y}>{y}</option>)}</select></label><button disabled={busy} onClick={explore}>{busy?'Loading trail…':'Explore this year on the map'}</button></>}
  <p className="fine">All available authorized GPS history is retained at source resolution. Map trails are sampled for speed. Gaps and GPS errors remain possible; coverage is not necessarily the bird’s entire lifetime. New observations accumulate without expiring at 30 days.</p>
 </>}</section>;
}
