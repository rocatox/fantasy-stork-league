import {useEffect,useState} from 'react';
export default function HistoryPanel({bird}:{bird:any}){
 const [info,setInfo]=useState<any>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;setInfo(null);setError('');
  fetch('/api/history?bird='+encodeURIComponent(bird.id)).then(async r=>{if(!r.ok)throw Error('History is temporarily unavailable.');return r.json();}).then((d:any)=>{if(active){setInfo(d);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};
 },[bird.id]);
 return <section className="spring-scouting" aria-label="Migration history"><h3>Spring migration record</h3>{error&&<p role="alert">{error}</p>}{!info&&!error&&<p>Fetching the scouting tape…</p>}{info&&<>
  <p className="history-coverage">{info.records?`${info.years.length} years of recorded movement to scout`:'Historical import pending.'}</p>
  {info.records>0&&!info.state?.complete&&<p>Backfill in progress; coverage is incomplete.</p>}

 {info.migration&&<div className="migration-record">
 <div className="migration-highlights"><div><strong>{info.migration.successes}<span> / {info.migration.attempts}</span></strong><span>confirmed arrivals / attempts</span></div><div><strong>{info.migration.typicalArrival&&info.migration.successes>1?new Date('2000-'+info.migration.typicalArrival+'T12:00:00Z').toLocaleDateString(undefined,{month:'short',day:'numeric',timeZone:'UTC'}):'—'}</strong><span>typical arrival · median date</span></div></div>
 {info.migration.pendingYears>0&&<p role="status">Analyzing {info.migration.pendingYears} historical seasons…</p>}
 {!!info.migration.seasons.filter((s:any)=>s.attempt).length&&<details className="crossing-history"><summary>Previous arrivals<span className="arrivals-chevron" aria-hidden="true"/></summary><ul className="migration-arrivals">{info.migration.seasons.filter((s:any)=>s.attempt).slice().reverse().map((s:any)=><li key={s.year}><b>{s.year}</b><span>{s.arrival?new Date(s.arrival).toLocaleDateString(undefined,{month:'short',day:'numeric',timeZone:'UTC'}):s.status==='ongoing'?'Season in progress':'Arrival not confirmed'}</span></li>)}</ul><p className="fine">Arrival dates show the first quality-screened GPS fix inside Germany, confirmed by another inside observation (UTC), not the exact crossing time. Missing tracking can hide arrivals.</p></details>}
 <p className="fine">January–June seasons first observed outside Germany; missing arrivals are unconfirmed.</p>
 </div>}
 </>}</section>;
}
