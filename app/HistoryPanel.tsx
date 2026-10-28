import {useEffect,useState} from 'react';
export default function HistoryPanel({bird}:{bird:any}){
 const [info,setInfo]=useState<any>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;setInfo(null);setError('');
  fetch('/api/history?bird='+encodeURIComponent(bird.id)).then(async r=>{if(!r.ok)throw Error('History is temporarily unavailable.');return r.json();}).then((d:any)=>{if(active){setInfo(d);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};
 },[bird.id]);
 return <section aria-label="Migration history"><h3>Spring migration record</h3>{error&&<p role="alert">{error}</p>}{!info&&!error&&<p>Fetching the scouting tape…</p>}{info&&<>
  <p>{info.records?`${info.years.length} years of recorded movement to scout`:'Historical import pending.'}</p>
  {info.records>0&&!info.state?.complete&&<p>Backfill in progress; coverage is incomplete.</p>}

 {info.migration&&<div className="migration-record">
 <p><b>{info.migration.successes} / {info.migration.attempts}</b> confirmed arrivals / recorded attempts</p>
 {info.migration.pendingYears>0&&<p role="status">Analyzing {info.migration.pendingYears} historical seasons…</p>}
 {info.migration.typicalArrival&&info.migration.successes>1&&<p>Typical arrival: <b>{new Date('2000-'+info.migration.typicalArrival+'T12:00:00Z').toLocaleDateString(undefined,{month:'short',day:'numeric',timeZone:'UTC'})}</b> (median recorded date)</p>}
 {!!info.migration.seasons.filter((s:any)=>s.attempt).length&&<details className="crossing-history"><summary>Previous German-border crossings</summary><ul className="migration-arrivals">{info.migration.seasons.filter((s:any)=>s.attempt).slice().reverse().map((s:any)=><li key={s.year}><b>{s.year}</b><span>{s.arrival?new Date(s.arrival).toLocaleDateString(undefined,{month:'short',day:'numeric',timeZone:'UTC'}):s.status==='ongoing'?'Season in progress':'Arrival not confirmed'}</span></li>)}</ul><p className="fine">Arrival dates show the first retained GPS fix inside Germany (UTC), not the exact crossing time. Missing tracking can hide arrivals.</p></details>}
 <p className="fine">January–June seasons first observed outside Germany; missing arrivals are unconfirmed.</p>
 </div>}
 </>}</section>;
}
