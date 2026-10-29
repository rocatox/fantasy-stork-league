import {useEffect,useState,useRef} from 'react';
export default function HistoryPanel({bird,onHistory,defer=false}:{bird:any,onHistory?:(info:any)=>void,defer?:boolean}){
 const panelRef=useRef<HTMLElement>(null);const [ready,setReady]=useState(!defer);
 useEffect(()=>{if(ready||!panelRef.current)return;const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setReady(true);observer.disconnect();}},{rootMargin:"400px"});observer.observe(panelRef.current);return()=>observer.disconnect();},[ready]);
 const [info,setInfo]=useState<any>(null),[error,setError]=useState('');
 useEffect(()=>{if(!ready)return;let active=true;setInfo(null);setError('');
  fetch('/api/history?bird='+encodeURIComponent(bird.id)).then(async r=>{if(!r.ok)throw Error('History is temporarily unavailable.');return r.json();}).then((d:any)=>{if(active){setInfo(d);onHistory?.({id:bird.id,first:d.first});}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};
 },[bird.id,ready]);
 return <section ref={panelRef} className="spring-scouting" aria-label="Migration history"><h3>Spring migration record</h3>{error&&<p role="alert">{error}</p>}{!info&&!error&&<p>Fetching the scouting tape…</p>}{info&&<>
  <p className="history-coverage">{info.records?`${info.years.length} years of recorded movement to scout`:'Historical import pending.'}</p>
  {info.records>0&&!info.state?.complete&&<p>Backfill in progress; coverage is incomplete.</p>}

 {info.migration&&<div className="migration-record">
 <div className="migration-highlights"><div><strong>{info.migration.successes}<span> / {info.migration.attempts}</span></strong><span>confirmed arrivals / attempts</span></div><div><strong>{info.migration.typicalArrival&&info.migration.successes>1?new Date('2000-'+info.migration.typicalArrival+'T12:00:00Z').toLocaleDateString(undefined,{month:'short',day:'numeric',timeZone:'UTC'}):'—'}</strong><span>typical arrival · median date</span></div><div title="Median absolute difference from the typical arrival date, in days. At least two confirmed arrivals are needed."><strong>{info.migration.arrivalSpreadDays!=null?info.migration.arrivalSpreadDays.toLocaleString(undefined,{maximumFractionDigits:1})+' d':'—'}</strong><span>arrival spread · median deviation</span></div></div>
 {info.migration.pendingYears>0&&<p role="status">Analyzing {info.migration.pendingYears} historical seasons…</p>}
 {!!info.migration.seasons.filter((s:any)=>s.attempt).length&&<details className="crossing-history"><summary>Previous arrivals<span className="arrivals-chevron" aria-hidden="true"/></summary><ul className="migration-arrivals">{info.migration.seasons.filter((s:any)=>s.attempt).slice().reverse().map((s:any)=><li key={s.year}><b>{s.year}</b><span>{s.arrival?new Date(s.arrival).toLocaleDateString(undefined,{month:'short',day:'numeric',timeZone:'UTC'}):s.status==='ongoing'?'Season in progress':'Arrival not confirmed'}</span></li>)}</ul><p className="fine">Arrival dates show the first quality-screened GPS fix inside Germany, supported by surrounding observations (UTC), not the exact crossing time. Missing tracking can hide arrivals.</p></details>}
 </div>}
 </>}</section>;
}
