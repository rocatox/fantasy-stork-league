'use client';
import {birdName} from '../lib/bird-name.mjs';
import {useEffect,useState,useRef} from 'react';
import {authenticatedFetch} from '../lib/authenticated-fetch.mjs';
import seed from '../data/seed.json';
import {loadTimeline,prefetchTimeline} from '../lib/timeline-cache.mjs';
import BirdProfile from './BirdProfile';
import LeagueHub from './LeagueHub';
import MigrationMap from './MigrationMap';
import LeagueMap from './LeagueMap';
import {birdStatus} from '../lib/bird-lifecycle.mjs';
import {easternParts,syncPolicy} from '../lib/sync-policy.mjs';
import {eligible} from '../lib/rules.mjs';
import {explorerBirds,explorerColor,compareBirds} from '../lib/map-birds.mjs';
import Portrait from './Portrait';
const colors=['#c29a34','#486a7a','#8f5ba5','#bf5260','#648c47','#b59b31','#417b70','#6472b3'];
const short=birdName;
const fmt=(s:string)=>new Date(s).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
const ageLabel=(stamp:string,now:number)=>{const hours=Math.max(0,Math.floor((now-Date.parse(stamp))/3600000));return !Number.isFinite(hours)?'Unknown':hours<1?'Under 1h':hours<24?hours+'h ago':Math.floor(hours/24)+'d ago';};
export default function StorkApp({auth}: {auth?:any}){
 const [starred,setStarred]=useState<string[]>(()=>{try{const value=JSON.parse(localStorage.getItem('stork-stars-v1')||'[]');return Array.isArray(value)?value.filter((id:any)=>typeof id==='string'):[];}catch{return [];}});
 const [starredOnly,setStarredOnly]=useState(false);
 function toggleStar(id:string){setStarred(previous=>{const next=previous.includes(id)?previous.filter(x=>x!==id):[...previous,id];try{localStorage.setItem('stork-stars-v1',JSON.stringify(next));}catch{setMessage('Your star is saved for this visit, but browser storage is unavailable.');}return next;});}
 const [timelineTarget,setTimelineTarget]=useState<HTMLDivElement|null>(null);
 const mapExplorerRef=useRef<HTMLDivElement>(null),showMapRef=useRef(false);
 const scoutingListRef=useRef<HTMLElement>(null);
 const authRef=useRef(auth);authRef.current=auth;
 async function authFetch(url:string,options:RequestInit={}){return authenticatedFetch(authRef.current?.getToken,url,options);}
 const signedIn=!!auth?.signedIn;const leagueRequest=useRef(0);const [leagueError,setLeagueError]=useState('');
 const [syncInfo,setSyncInfo]=useState<any>({syncActive:false,sources:[],asOf:seed.asOf}); const profileRef=useRef<HTMLElement>(null); const [trail,setTrail]=useState<any>(null); const [trailStatus,setTrailStatus]=useState(''),[trailRetry,setTrailRetry]=useState(0);
 const [birds,setBirds]=useState<any[]>([]),[view,setView]=useState('map'),[selected,setSelected]=useState<any>(null),[query,setQuery]=useState(''),[only,setOnly]=useState(true),[leagues,setLeagues]=useState<any[]>([]),[leagueId,setLeagueId]=useState(''),[userId,setUserId]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[name,setName]=useState(''),[invite,setInvite]=useState(''),[now,setNow]=useState(Date.now()),[team,setTeam]=useState('all'),[sort,setSort]=useState('distance'),[loaded,setLoaded]=useState(false);
 const [rankings,setRankings]=useState<any>(null),[rankingsLoading,setRankingsLoading]=useState(false),[rankingsError,setRankingsError]=useState(false),[rankingsRetry,setRankingsRetry]=useState(0);
 useEffect(()=>{
  if(!loaded||!['success','arrival'].includes(sort)||rankings?.asOf===syncInfo.asOf)return;
  const controller=new AbortController();let active=true;setRankingsLoading(true);setRankingsError(false);
  fetch('/api/history?rankings=1',{signal:controller.signal}).then(async r=>{if(!r.ok)throw Error('Rankings unavailable');const d:any=await r.json();if(!d.rankings)throw Error('Rankings unavailable');if(active)setRankings({asOf:syncInfo.asOf,values:d.rankings});}).catch(e=>{if(active&&e.name!=='AbortError')setRankingsError(true);}).finally(()=>{if(active)setRankingsLoading(false);});
  return()=>{active=false;controller.abort();};
 },[sort,loaded,syncInfo.asOf,rankingsRetry]);
 async function refresh(){try{const r=await fetch('/api/birds');const d:any=await r.json();if(!r.ok||d.notice)throw Error('Tracking is temporarily unavailable. Your picks and leagues are safe.');setBirds(d.birds);setLoaded(true);setSyncInfo(d);setNow(Date.now());setSelected((old:any)=>d.birds.find((b:any)=>b.id===(old?.id||new URLSearchParams(location.search).get('bird')))||null);setTrail((old:any)=>old&&d.birds.some((b:any)=>b.id===old.id)?old:null);}catch{setMessage('Unable to refresh live data. Please check your connection.');}}
 async function refreshLeagues(){const request=++leagueRequest.current;const current=authRef.current;if(!current?.ready||!current.signedIn){setLeagues([]);setUserId('');setLeagueError('');return;}try{const r=await authFetch('/api/leagues');const d:any=await r.json();if(!r.ok)throw Error(d.error||'League access is temporarily unavailable. Please retry.');if(request!==leagueRequest.current||current.userId!==authRef.current?.userId)return;if(!d.signedIn)throw Error('You are signed in, but the server could not verify your session. Sign out and sign in again, then retry.');setLeagues(d.leagues);setUserId(d.userId||'');setLeagueError('');}catch(e:any){if(request===leagueRequest.current)setLeagueError(e.message||'Could not load leagues. Please retry.');}}

 useEffect(()=>{refresh();refreshLeagues();const p=new URLSearchParams(location.search);if(p.get('invite')){setInvite(p.get('invite')!);setView('leagues');}if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});const t=setInterval(()=>{refresh();refreshLeagues();},60000);return()=>clearInterval(t);},[]);
 useEffect(()=>{if(auth?.ready)refreshLeagues();},[auth?.ready,auth?.signedIn,auth?.userId,auth?.displayName]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape')closeProfile();};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);

 useEffect(()=>{
  setTrail(null);setTrailStatus('');
  if(!selected||view==='leagues')return;
  let active=true;
  setTrailStatus('Loading migration timeline…');
  loadTimeline(selected.id)
   .then((d:any)=>{if(!active)return;if(!d.points?.length){setTrailStatus('No migration history is available yet.');return;}setTrail({...selected,history:d.points,replay:true});setTrailStatus('');})
   .catch(e=>{if(active&&e.name!=='AbortError')setTrailStatus('Could not load the migration timeline.');});
  return()=>{active=false;};
 },[selected?.id,trailRetry,view]);
 useEffect(()=>{if(selected){profileRef.current?.focus({preventScroll:true});if(showMapRef.current){mapExplorerRef.current?.scrollIntoView({behavior:'smooth',block:'start'});showMapRef.current=false;}else profileRef.current?.scrollIntoView({behavior:'smooth',block:'nearest'});}},[selected?.id]);
 function closeProfile(){setSelected(null);setTrail(null);history.replaceState(null,'','/');}

 const racing=syncPolicy(now).racing;const seasonYear=Number(easternParts(now).year)+(Number(easternParts(now).month)>6?1:0);
 const league=leagues.find(l=>l.id===leagueId);
 const filtered=view==='leagues'?birds.filter(b=>league?.picks.some((p:any)=>p.birdId===b.id&&(team==='all'||p.userId===team))):explorerBirds(birds,{only,study:'all',query,now}).filter((b:any)=>!starredOnly||starred.includes(b.id)).sort((a:any,b:any)=>compareBirds(a,b,sort,rankings?.values));
 useEffect(()=>{
  const list=scoutingListRef.current,row=list?.querySelector<HTMLElement>('.birdrow-selected');
  if(!list||!row)return;
  const bounds=list.getBoundingClientRect(),item=row.getBoundingClientRect();
  const heading=list.querySelector('.listhead')?.getBoundingClientRect().height||0;
  if(item.top<bounds.top+heading||item.bottom>bounds.bottom)list.scrollTo({top:list.scrollTop+item.top-bounds.top-heading,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
 },[selected?.id,view,sort,query,only,rankings]);
 async function action(action:string,extra:any={}){setBusy(true);setMessage('');try{const r=await authFetch('/api/leagues',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,id:leagueId,name,invite,...extra})});const d:any=await r.json();if(!r.ok)throw Error(d.error||'Request failed');setLeagueId(d.league.id);await refreshLeagues();setMessage(action==='pick'?'Signed. Your scouting department approves.':action==='start'?'The draft is on. Check whose pick is next.':action==='create'?'League created. Copy your invitation and assemble the managers.':action==='join'?'You’re in. Welcome to the flock.':'League updated.');}catch(e:any){setMessage(e.message);}finally{setBusy(false);}}
 function birdColor(b:any){if(birdStatus(b,now)!=='active')return '#858b8a';if(view!=='leagues')return explorerColor(b,now);const p=league?.picks.find((p:any)=>p.birdId===b.id);return p?colors[league.members.findIndex((m:any)=>m.id===p.userId)]: '#c29a34';}
 function choose(b:any){if(view==='birds'){showMapRef.current=true;setView('map');}setSelected(b);history.replaceState(null,'','?bird='+encodeURIComponent(b.id));}
 function scoutingStat(b:any){
  if(sort!=='success'&&sort!=='arrival')return null;
  const r=rankings?.values?.[b.id];let text='',label='';
  if(!r){text=rankingsError?'Unavailable':'Loading…';label='Migration statistic '+text.toLowerCase();}
  else if(r.pendingYears){text='Pending';label='Historical migration analysis is incomplete';}
  else if(sort==='success'&&r.attempts>0){text=Math.round(100*r.successes/r.attempts)+'% · '+r.successes+'/'+r.attempts;label=r.successes+' confirmed spring arrivals from '+r.attempts+' recorded attempts';}
  else if(sort==='arrival'&&r.typicalArrival){text=new Date('2000-'+r.typicalArrival+'T12:00:00Z').toLocaleDateString(undefined,{month:'short',day:'numeric',timeZone:'UTC'});label='Typical arrival: '+text+' (median recorded date)';}
  else{text=sort==='success'?'No attempts':'No typical date';label=sort==='success'?'No recorded spring migration attempts':'Not enough confirmed arrivals for a typical date';}
  return <span className="scouting-stat" title={label} aria-label={label}>{text}</span>;
 }
 const visibleTrail=selected?(trail?.id===selected.id?trail:{...selected,history:[],replay:true}):null;
 const map=view==='leagues'?<LeagueMap birds={filtered} selected={selected} color={birdColor} onBird={choose} now={now}/>:<MigrationMap birds={filtered} trail={visibleTrail} color={birdColor} onBird={choose} replayStatus={trailStatus} onRetry={()=>setTrailRetry(v=>v+1)} league={view==='leagues'} externalTimeline={view==='map'} timelineTarget={timelineTarget}/>;
 const deadline=<aside className="season-deadline" aria-label={racing?'Season end':'Draft deadline'}><span className="deadline-label">{racing?'Season ends':'Draft deadline'}</span><strong>{racing?'Jun 30':'Jan 15'}<span>, {seasonYear}</span></strong><span className="deadline-time">11:59 p.m. Eastern</span></aside>;
 const profile=selected&&<BirdProfile key={selected.id} bird={selected} now={now} starred={starred.includes(selected.id)} onStar={()=>toggleStar(selected.id)} profileRef={profileRef} onClose={closeProfile} timelineRef={view==='map'?setTimelineTarget:undefined}/>;
 return <><header><a className="brand" href="/" aria-label="Fantasy Stork League home"><img className="brand-mark" src="/migration-arrow-white-v1.svg" alt="" width={48} height={48}/><span>FANTASY<br/><b>STORK LEAGUE</b></span></a><nav aria-label="Main navigation">{[['map','Migration map'],['birds','Scout storks'],['leagues','My leagues'],['rules','How to play']].map(([key,label])=><button key={key} aria-pressed={view===key} className={view===key?'active':''} onClick={()=>{if(key!==view){closeProfile();setView(key);}}}>{label}</button>)}</nav><div className="header-account"><span className="season">{seasonYear} SEASON</span><div className="accountcontrols">{auth?.ready&&auth?.control}</div></div></header>
 <main>
 {(view!=='map'&&view!=='birds')&&deadline}
 {loaded&&!!syncInfo.overdueStudies?.length&&<div className="notice" role="status"><span className="dot"/><div><b>Some tracking updates are delayed.</b><span> Last known positions remain visible. Check each bird’s observation age before drafting.</span></div><button onClick={refresh}>Check again ↻</button></div>}
 {message&&<div role="status" className="message">{message}<button aria-label="Dismiss message" onClick={()=>setMessage('')}>×</button></div>}
 {(view==='map'||view==='birds')&&<><div className="toolbar"><input aria-label="Search storks" placeholder="Search name, ring or country…" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Sort storks" value={sort} onChange={e=>setSort(e.target.value)}><option value="distance">Closest to Germany</option><option value="freshness">Latest observation</option><option value="success">Success ratio ↓</option><option value="arrival">Typical arrival ↑</option><option value="name">Name A–Z</option></select>{['success','arrival'].includes(sort)&&rankingsLoading&&<span className="ranking-status" role="status">Loading rankings…</span>}{['success','arrival'].includes(sort)&&rankingsError&&<button className="ranking-status" onClick={()=>setRankingsRetry(v=>v+1)}>Retry rankings</button>}<div className="scouting-filters"><label className="check"><input type="checkbox" checked={only} onChange={e=>setOnly(e.target.checked)}/>Eligible only</label><label className="check"><input type="checkbox" checked={starredOnly} onChange={e=>setStarredOnly(e.target.checked)}/>Starred only</label></div>{deadline}</div>
 {view==='map'?<div ref={mapExplorerRef} className="explorer interactive-explorer">{map}<aside ref={scoutingListRef} className="birdlist"><div className="listhead">SCOUTING REPORT <span>{filtered.length} birds</span></div>{filtered.map(b=><button key={b.id} className={selected?.id===b.id?"birdrow birdrow-selected":"birdrow"} aria-pressed={selected?.id===b.id} onPointerEnter={()=>prefetchTimeline(b.id)} onFocus={()=>prefetchTimeline(b.id)} onClick={()=>choose(b)}><Portrait bird={b}/><span className="birdrow-content"><span className="birdrow-heading"><b>{short(b.name)}<span className={"scouting-star"+(starred.includes(b.id)?"":" scouting-star-empty")} aria-label={starred.includes(b.id)?"Starred":undefined} aria-hidden={!starred.includes(b.id)}> ★</span></b>{scoutingStat(b)}</span><small>{birdStatus(b,now)!=='active'?birdStatus(b,now)+' · ':''}{b.country} · {Math.round(b.distanceToGermanyMiles).toLocaleString()} mi to Germany · Seen {ageLabel(b.latestValidFixUtc,now)}</small></span><span>›</span></button>)}{!filtered.length&&<p className="empty">{loaded?'No birds on this board. Try another search or turn off a filter.':'Loading the scouting board…'}</p>}</aside></div>:<div className="scout-profiles">{filtered.map(b=><BirdProfile key={b.id} bird={b} now={now} starred={starred.includes(b.id)} onStar={()=>toggleStar(b.id)} compact onMap={choose}/>)}{!filtered.length&&<p className="empty">{loaded?"No storks match these filters.":"Loading storks…"}</p>}</div>}</>}
 {view==='leagues'&&<LeagueHub teamColors={colors} starred={starred} sort={sort} setSort={setSort} rankings={rankings?.values} rankingsLoading={rankingsLoading} rankingsError={rankingsError} onRetryRankings={()=>setRankingsRetry(v=>v+1)} scoutingStat={scoutingStat} auth={auth} signedIn={signedIn} busy={busy} name={name} setName={setName} invite={invite} setInvite={setInvite} leagues={leagues} leagueId={leagueId} userId={userId} leagueError={leagueError} onRetry={refreshLeagues} onSelectLeague={(id:string)=>{closeProfile();setLeagueId(id);setTeam('all');}} action={action} birds={birds} now={now} onBird={choose} team={team} setTeam={(id:string)=>{closeProfile();setTeam(id);}} map={map}/>}
 {(view==='map'||view==='leagues')&&profile}
 {view==='rules'&&<div className="rulesgrid"><section className="panel"><span className="eyebrow">01 / THE DRAFT</span><h2>Build a flock, take turns.</h2><p>2–8 players. Up to 6 storks each. With 30 eligible birds, eight players draft three each; five players draft six each.</p><p>The randomly assigned draft order reverses every round. Each bird belongs to one player per league. Team size locks when drafting starts.</p><p>Finish drafting by the end of January 15 in America/New_York. Unfinished leagues are disbanded at the deadline. Eligibility is checked again at each pick. Before season start (January 16, midnight Eastern), deceased or inactive drafted birds may be replaced first come, first served, without a turn order. Replacements must be eligible and unclaimed in the league. Unreplaced affected picks score zero, even if tracking later resumes; no replacements are allowed after season start.</p></section><section className="panel"><span className="eyebrow">02 / ELIGIBILITY</span><h2>Fresh observations. A fair start.</h2><p>A valid GPS observation no more than 30 days old, outside Germany and strictly more than 450 miles from its nearest border, coastline or island.</p><p>Known mortality, ended deployments and uncertain identities are excluded. During the season, a bird with stale tracking stays on its team; pre-season replacement rights must be used before season start.</p></section><section className="panel"><span className="eyebrow">03 / THE RACE</span><h2>Germany is the finish line.</h2><p>Rank birds by their first quality-screened recorded position inside Germany, supported by consistent surrounding observations. Tracking gaps can be corroborated by a later inside fix; brief crossings need plausible nearby observations before and after, with the fix at least 200 metres inside Germany. Unsupported fixes stay unconfirmed. The first supported fix supplies the arrival time. A league with M drafted birds awards M points for first, M−1 for second, and so on. Nonfinishers score zero.</p><p>The season ends June 30 Eastern. Equal-time finishers share the points for their occupied places; arrival rankings stay provisional for 72 hours. Standings use observation time, not upload time. Late arrivals and corrected observations reopen the 72-hour review period. An exact boundary point waits for a subsequent fix strictly inside Germany.</p></section><section className="panel"><span className="eyebrow">04 / THE DATA</span><h2>Real birds. Occasionally patchy signals.</h2><p>GPS updates run every six hours outside racing, hourly January 16–June 30, and discovery runs daily within the eight approved studies. Last successful sync and observation time are separate.</p><p>Newly eligible birds enter the shared draft pool after identity, deployment and location checks; new studies require review. Source failures retain the last known observations and do not reset their age.</p></section></div>}
 <footer><details><summary>Data sources & attribution</summary><p>{seed.attribution.creators}</p><p>Race and distance boundary: © <a href="https://www.bkg.bund.de">BKG</a> (2026), <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. <a href="https://sgx.geodatenzentrum.de/web_public/gdz/datenquellen/datenquellen_vg25.pdf">Data sources</a>. VG25 features selected and combined without simplification; offshore and technical lake partitions excluded.</p><p>{seed.attribution.changes} Distances and trails are derived; historical records are retained separately from recent-location snapshots. Sampled trails and available-track distances are not lifetime measurements.</p>{seed.studies.map(s=><p key={s.studyId}><a href={s.sourceUrl} target="_blank" rel="noreferrer">{s.study}</a> · <a href={s.licenseUrl}>{s.license}</a></p>)}</details><details className="tracking-details"><summary>Tracking & data status</summary><p>{syncInfo.sources?.length||0}/8 sources connected. {syncInfo.sources?.length?'Oldest source check: '+fmt(syncInfo.asOf):'Waiting for tracking data.'} Updates every {syncInfo.policy?.intervalHours||6} hours; new birds checked daily.</p><button onClick={refresh}>Refresh tracking data</button></details></footer></main>

 </>;
}





