import {useEffect,useState} from 'react';
export default function HistoryPanel({bird}:{bird:any}){
 const [info,setInfo]=useState<any>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;setInfo(null);setError('');
  fetch('/api/history?bird='+encodeURIComponent(bird.id)).then(async r=>{if(!r.ok)throw Error('History is temporarily unavailable.');return r.json();}).then((d:any)=>{if(active){setInfo(d);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};
 },[bird.id]);
 return <section aria-label="Migration history"><h3>Migration history</h3>{error&&<p role="alert">{error}</p>}{!info&&!error&&<p>Fetching the scouting tape…</p>}{info&&<>
  <p>{info.records?`${info.years.length} years of recorded movement to scout`:'Historical import pending.'}</p>
  {info.records>0&&!info.state?.complete&&<p>Backfill in progress; coverage is incomplete.</p>}

 </>}</section>;
}
