import {fetchWithTimeout} from '../lib/request-timeout.mjs';
import {visiblePoll} from '../lib/visible-poll.mjs';
import HowToPlay from './HowToPlay';
import {NotificationsProvider,NotificationBell,useNotifications} from './Notifications';
import Settings,{PreferencesProvider,usePreferences} from './Preferences';
import {SortFilter} from './FilterMenu';
import {StarSymbol} from './ListIcon';
'use client';
import {birdName} from '../lib/bird-name.mjs';
import {useEffect,useState,useRef,useMemo,useCallback} from 'react';
import {mapPriority} from '../lib/map-priority.mjs';
import {authenticatedFetch} from '../lib/authenticated-fetch.mjs';
import seed from '../data/seed.json';
import {loadFullTrail} from '../lib/trail-loader';
import {ScoutListsProvider,ListFilter,useScoutLists,BirdListMarks} from './ScoutLists';
import BirdProfile from './BirdProfile';
import ScoutProfiles from './ScoutProfiles';
import LeagueHub from './LeagueHub';
import RecentMigrationMap,{useRecentTrails} from './RecentMigrationMap';
import LeagueMap from './LeagueMap';
import {birdStatus} from '../lib/bird-lifecycle.mjs';
import {easternParts,syncPolicy} from '../lib/sync-policy.mjs';
import {eligible,cutoff} from '../lib/rules.mjs';
import {explorerBirds,explorerColor,compareBirds,leagueMapBirds} from '../lib/map-birds.mjs';
import Portrait from './Portrait';
const colors=['#c29a34','#4278bf','#7956b8','#d94f54','#649d36','#ed7c31','#98704f','#e78eac'];
const short=birdName;
const fmt=(s:string)=>new Date(s).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
const ageLabel=(stamp:string,now:number)=>{const hours=Math.max(0,Math.floor((now-Date.parse(stamp))/3600000));return !Number.isFinite(hours)?'Unknown':hours<1?'Under 1h':hours<24?hours+'h ago':Math.floor(hours/24)+'d ago';};
export default function StorkApp({auth}: {auth?:any}){return <PreferencesProvider auth={auth}><NotificationsProvider auth={auth}><ScoutListsProvider auth={auth}><StorkContent auth={auth}/></ScoutListsProvider></NotificationsProvider></PreferencesProvider>;}
function StorkContent({auth}: {auth?:any}){
 const notifications=useNotifications();
 const scoutLists=useScoutLists();const prefs=usePreferences();
 const [starred,setStarred]=useState<string[]>(()=>{try{const value=JSON.parse(localStorage.getItem('stork-stars-v1')||'[]');return Array.isArray(value)?value.filter((id:any)=>typeof id==='string'):[];}catch{return [];}});
 const [starredOnly,setStarredOnly]=useState(false);
 function toggleStar(id:string){setStarred(previous=>{const next=previous.includes(id)?previous.filter(x=>x!==id):[...previous,id];try{localStorage.setItem('stork-stars-v1',JSON.stringify(next));}catch{setMessage('Your star is saved for this visit, but browser storage is unavailable.');}return next;});}
 const [timelineTarget,setTimelineTarget]=useState<HTMLDivElement|null>(null);
 const mapExplorerRef=useRef<HTMLDivElement>(null),showMapRef=useRef(false);
 const scoutingListRef=useRef<HTMLElement>(null),scoutOrderRef=useRef<any>(null);
 const authRef=useRef(auth);authRef.current=auth;
 async function authFetch(url:string,options:RequestInit={}){return authenticatedFetch(authRef.current?.getToken,url,options);}
 const actionPending=useRef(false);const [trackingError,setTrackingError]=useState(false);
 const signedIn=!!auth?.signedIn;const leagueRequest=useRef(0);const [leagueError,setLeagueError]=useState('');
 const [syncInfo,setSyncInfo]=useState<any>({syncActive:false,sources:[],asOf:seed.asOf}); const profileRef=useRef<HTMLElement>(null); const [trail,setTrail]=useState<any>(null); const [trailStatus,setTrailStatus]=useState(''),[trailRetry,setTrailRetry]=useState(0);
 const [birds,setBirds]=useState<any[]>([]),[view,setView]=useState(()=>{const p=new URLSearchParams(location.search),v=p.get('view');if(v&&['map','birds','leagues','rules','settings'].includes(v))return v;if(p.has('invite')||p.has('league'))return 'leagues';if(p.has('bird'))return 'map';try{const saved=sessionStorage.getItem('stork-view');return saved&&['map','birds','leagues','rules','settings'].includes(saved)?saved:'map';}catch{return 'map';}}),[selected,setSelected]=useState<any>(null),[query,setQuery]=useState(''),[only,setOnly]=useState(true),[leagues,setLeagues]=useState<any[]>([]),[leagueId,setLeagueId]=useState(()=>{const p=new URLSearchParams(location.search);return p.has('invite')?'':p.get('league')||'';}),[userId,setUserId]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[name,setName]=useState(''),[invite,setInvite]=useState(''),[now,setNow]=useState(Date.now()),[team,setTeam]=useState('all'),[sort,setSort]=useState('distance'),[loaded,setLoaded]=useState(false);
 const recentTrails=useRecentTrails(birds,now,syncInfo.asOf);
 const poolReturnTeam=useRef<{leagueId:string,team:string}|null>(null);
 const settingsReturnView=useRef('map');
 useEffect(()=>{if(view!=='settings')settingsReturnView.current=view;},[view]);
 useEffect(()=>{try{sessionStorage.setItem('stork-view',view);}catch{}const url=new URL(location.href);url.searchParams.set('view',view);if(view==='leagues'&&leagueId)url.searchParams.set('league',leagueId);else url.searchParams.delete('league');if(view!=='leagues')url.searchParams.delete('invite');history.replaceState(null,'',url.pathname+url.search+url.hash);},[view,leagueId]);
 useEffect(()=>{if(!message)return;const timeout=setTimeout(()=>setMessage(''),10000);return()=>clearTimeout(timeout);},[message]);
 const [rankings,setRankings]=useState<any>(null),[rankingsLoading,setRankingsLoading]=useState(false),[rankingsError,setRankingsError]=useState(false),[rankingsRetry,setRankingsRetry]=useState(0);
 useEffect(()=>{
  if(!loaded||!['success','arrival'].includes(sort)||(rankings?.asOf===syncInfo.asOf&&(!rankings.pending||Date.now()-rankings.checkedAt<60000)))return;
  const controller=new AbortController();let active=true;setRankingsLoading(true);setRankingsError(false);
  fetch('/api/history?rankings=1',{signal:controller.signal}).then(async r=>{if(!r.ok)throw Error('Rankings unavailable');const d:any=await r.json();if(!d.rankings)throw Error('Rankings unavailable');if(active)setRankings({asOf:syncInfo.asOf,values:d.rankings,checkedAt:Date.now(),pending:Object.values(d.rankings).some((r:any)=>r.pendingYears>0)});}).catch(e=>{if(active&&e.name!=='AbortError')setRankingsError(true);}).finally(()=>{if(active)setRankingsLoading(false);});
  return()=>{active=false;controller.abort();};
 },[sort,loaded,syncInfo.asOf,rankingsRetry,now]);
 async function refresh(){try{const r=await fetchWithTimeout('/api/birds');const d:any=await r.json();if(!r.ok||d.notice)throw Error('Tracking is temporarily unavailable. Your picks and leagues are safe.');setBirds(d.birds);setLoaded(true);setTrackingError(false);setSyncInfo(d);setNow(Date.now());setSelected((old:any)=>d.birds.find((b:any)=>b.id===(old?.id||new URLSearchParams(location.search).get('bird')))||null);setTrail((old:any)=>old&&d.birds.some((b:any)=>b.id===old.id)?old:null);}catch{setTrackingError(true);}}
 async function refreshLeagues(){const request=++leagueRequest.current;const current=authRef.current;if(!current?.ready||!current.signedIn){setLeagues([]);setUserId('');setLeagueError('');return;}try{const r=await authFetch('/api/leagues');const d:any=await r.json();if(!r.ok)throw Error(d.error||'League access is temporarily unavailable. Please retry.');if(request!==leagueRequest.current||current.userId!==authRef.current?.userId)return;if(!d.signedIn)throw Error('You are signed in, but the server could not verify your session. Sign out and sign in again, then retry.');setLeagues(d.leagues);setLeagueId(previous=>d.leagues.some((l:any)=>l.id===previous&&!['disbanded','abandoned'].includes(l.status))?previous:'');setUserId(d.userId||'');setLeagueError('');}catch(e:any){if(request===leagueRequest.current)setLeagueError(e.message||'Could not load leagues. Please retry.');}}

 useEffect(()=>{const p=new URLSearchParams(location.search);if(p.get('invite')){setInvite(p.get('invite')!);setView('leagues');}if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});},[]);
 useEffect(()=>visiblePoll(()=>Promise.all([refresh(),refreshLeagues()]),{interval:()=>syncPolicy().racing||view==='leagues'?60000:300000}),[view]);
 useEffect(()=>{if(auth?.ready)refreshLeagues();},[auth?.ready,auth?.signedIn,auth?.userId,auth?.displayName]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!document.querySelector('dialog[open]'))closeProfile();};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[leagueId]);

 useEffect(()=>{
  setTrail(null);setTrailStatus('');
  if(!selected||view==='leagues')return;
  let active=true;
  setTrailStatus('Loading migration timeline…');
  loadFullTrail(selected.id)
   .then((d:any)=>{if(!active)return;if(!d.points?.length){setTrailStatus('No migration history is available yet.');return;}setTrail({...selected,history:d.points,prepared:d,replay:true});setTrailStatus('');})
   .catch(e=>{if(active&&e.name!=='AbortError')setTrailStatus('Could not load the migration timeline.');});
  return()=>{active=false;};
 },[selected?.id,trailRetry,view]);
 useEffect(()=>{
  if(!selected)return;
  const profile=profileRef.current;if(!profile)return;
  profile.focus({preventScroll:true});
  if(showMapRef.current){mapExplorerRef.current?.scrollIntoView({behavior:prefs.reduced?'instant':'smooth',block:'start'});showMapRef.current=false;return;}
  if(view!=='map'){profile.scrollIntoView({behavior:prefs.reduced?'instant':'smooth',block:'nearest'});return;}
  // Reveal only the controls, once they exist. Late history must not pull a
  // player back after they have started scrolling or interacting elsewhere.
  let done=false,frame=0;
  const stop=()=>{done=true;observer.disconnect();cancelAnimationFrame(frame);};
  const reveal=()=>{
   if(done)return;
   const controls=profile.querySelector('.migration-timeline.timeline-compact');if(!controls)return;
   const rect=controls.getBoundingClientRect();if(!rect.height)return;
   const delta=rect.top<0?rect.top:rect.bottom>window.innerHeight?rect.bottom-window.innerHeight:0;
   stop();if(delta)window.scrollBy({top:delta,behavior:prefs.reduced?'instant':'smooth'});
  };
  const observer=new MutationObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(reveal);});
  observer.observe(profile,{childList:true,subtree:true});frame=requestAnimationFrame(reveal);
  window.addEventListener('wheel',stop,{passive:true});window.addEventListener('pointerdown',stop);window.addEventListener('keydown',stop);
  return()=>{stop();window.removeEventListener('wheel',stop);window.removeEventListener('pointerdown',stop);window.removeEventListener('keydown',stop);};
 },[selected?.id]);
 function closeProfile(){mapPriority.hold();const previous=poolReturnTeam.current;poolReturnTeam.current=null;if(previous?.leagueId===leagueId)setTeam(previous.team);setSelected(null);setTrail(null);const url=new URL(location.href);url.searchParams.delete('bird');history.replaceState(null,'',url.pathname+url.search+url.hash);}

 const racing=syncPolicy(now).racing;const seasonYear=Number(easternParts(now).year)+(Number(easternParts(now).month)>6?1:0);
 const league=leagues.find(l=>l.id===leagueId);
 const filtered=useMemo(()=>view==='leagues'?leagueMapBirds(birds,league,team,now):explorerBirds(birds,{only,study:'all',query,now}).filter((b:any)=>(!starredOnly||starred.includes(b.id))&&scoutLists.matches(b.id)).sort((a:any,b:any)=>compareBirds(a,b,sort,rankings?.values)),[view,birds,league,team,now,only,query,starredOnly,starred,scoutLists,sort,rankings]);
 useEffect(()=>{if(view!=='leagues'||team!=='undrafted')return;if(league&& (league.status!=='ready'||now>=cutoff(league.year))){closeProfile();setTeam('all');}else if(selected&&!filtered.some((b:any)=>b.id===selected.id))closeProfile();},[view,team,league,now,birds,selected?.id]);
 useEffect(()=>{
  const list=scoutingListRef.current,row=list?.querySelector<HTMLElement>('.birdrow-selected');
  if(!list||!row)return;
  const bounds=list.getBoundingClientRect(),item=row.getBoundingClientRect();
  const heading=list.querySelector('.listhead')?.getBoundingClientRect().height||0;
  if(item.top<bounds.top+heading||item.bottom>bounds.bottom)list.scrollTo({top:list.scrollTop+item.top-bounds.top-heading,behavior:prefs.reduced?'instant':'smooth'});
 },[selected?.id,view,sort,query,only,rankings]);
 async function action(action:string,extra:any={}){if(actionPending.current)return false;actionPending.current=true;setBusy(true);setMessage('');try{const r=await authFetch('/api/leagues',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,id:leagueId,name,invite,...extra})});const d:any=await r.json();if(!r.ok)throw Error(d.error||'Request failed');setLeagueId(['disband','leave'].includes(action)?'':d.league.id);if(['disband','leave'].includes(action))closeProfile();await refreshLeagues();notifications.refresh();setMessage(action==='leave'?'You left the league.':action==='disband'?'League disbanded.':action==='swap'?'Swap complete. Your roster is updated and conflicting proposals cancelled.':action==='proposeTrade'?'Trade proposal sent.':action==='acceptTrade'?'Trade accepted. Rosters updated and conflicting proposals cancelled.':action==='cancelTrade'?'Trade proposal cancelled.':action==='declineTrade'?'Trade declined.':action==='pick'?'Signed. Your scouting department approves.':action==='start'?'The draft is on. Check whose pick is next.':action==='create'?'League created. Copy your invitation and assemble the managers.':action==='join'?'You’re in. Welcome to the flock.':'League updated.');return true;}catch(e:any){setMessage(e.message);return false;}finally{actionPending.current=false;setBusy(false);}}
 const birdColor=useCallback((b:any)=>{if(birdStatus(b,now)!=='active')return '#858b8a';if(view!=='leagues')return explorerColor(b,now);const p=league?.picks.find((p:any)=>p.birdId===b.id);return p?colors[league.members.findIndex((m:any)=>m.id===p.userId)]: '#c29a34';},[now,view,league]);
 function choose(b:any){mapPriority.hold();if(view==='leagues'){const pick=league?.picks.find((p:any)=>p.birdId===b.id);if(pick){const previous=poolReturnTeam.current;poolReturnTeam.current=null;const target=previous?.leagueId===leagueId?previous.team:team;setTeam(target==='all'||target===pick.userId?target:'all');}else if(league?.status==='ready'&&now<cutoff(league.year)){if(poolReturnTeam.current?.leagueId!==leagueId)poolReturnTeam.current={leagueId,team};setTeam('undrafted');}}if(view==='birds'){showMapRef.current=true;setView('map');}setSelected(b);const url=new URL(location.href);url.searchParams.set('bird',b.id);url.searchParams.set('view',view==='birds'?'map':view);history.replaceState(null,'',url.pathname+url.search+url.hash);}
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
 const map=view==='leagues'?<LeagueMap birds={filtered} selected={selected} color={birdColor} onBird={choose} now={now}/>:<RecentMigrationMap recent={recentTrails} birds={filtered} trail={visibleTrail} color={birdColor} onBird={choose} replayStatus={trailStatus} onRetry={()=>setTrailRetry(v=>v+1)} league={view==='leagues'} externalTimeline={view==='map'} timelineTarget={timelineTarget}/>;
 const deadline=<aside className="season-deadline" aria-label={racing?'Race deadline':'Preseason deadline'}><span className="deadline-label">{racing?'Race deadline':'Preseason deadline'}</span><strong>{racing?'Jun 30':'Jan 15'}<span>, {seasonYear}</span></strong><span className="deadline-time">11:59 p.m. Eastern</span></aside>;
 const selectedManager=view==='leagues'&&league?.members.find((m:any)=>m.id===league.picks.find((p:any)=>p.birdId===selected?.id)?.userId);
 const profileTeam=view==='leagues'&&league?{name:selectedManager?selectedManager.name+"’s team"+(selectedManager.id===userId?" (you)":""):"Undrafted in this league",color:selectedManager?colors[league.members.findIndex((m:any)=>m.id===selectedManager.id)]:undefined}:undefined;
 const profile=selected&&<BirdProfile key={selected.id} bird={selected} now={now} leagueTeam={profileTeam} starred={starred.includes(selected.id)} onStar={()=>toggleStar(selected.id)} profileRef={profileRef} onClose={closeProfile} timelineRef={view==='map'?setTimelineTarget:undefined}/>;
 return <><header><a className="brand" href="/?view=map" aria-label="Fantasy Stork League home" onClick={e=>{if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();closeProfile();setView('map');}}><img className="brand-mark" src="/migration-arrow-white-v1.svg" alt="" width={48} height={48}/><span>FANTASY<br/><b>STORK LEAGUE</b></span></a><nav aria-label="Main navigation">{[['map','Migration map'],['birds','Scout storks'],['leagues','My leagues'],['rules','How to play']].map(([key,label])=><button key={key} aria-pressed={view===key} className={view===key?'active':''} onClick={()=>{if(key!==view){closeProfile();setView(key);}}}>{label}</button>)}</nav><div className="header-account"><NotificationBell onLeague={(id:string)=>{closeProfile();setLeagueId(id);setTeam('all');setView('leagues');refreshLeagues();}}/><button className="settings-toggle" aria-label="Settings" title="Settings" aria-pressed={view==='settings'} onClick={()=>{closeProfile();setView('settings');}}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 17h16M8 4v6M16 14v6"/></svg></button><span className="season">{seasonYear} SEASON</span><div className="accountcontrols">{auth?.ready&&auth?.control}</div></div></header>
 <main data-recent-trails-cached={Object.keys(recentTrails.histories).length}>
 {trackingError&&<div className="notice" role="alert"><span>Tracking could not be refreshed. {loaded?'Showing the last loaded birds.':'Check your connection and retry.'}</span><button onClick={refresh}>Retry tracking</button></div>}
 {view==='settings'&&<Settings auth={auth} onClose={()=>setView(settingsReturnView.current)}/>}
 {(view==='leagues'||view==='rules')&&deadline}
 {loaded&&!!syncInfo.overdueStudies?.length&&<div className="notice" role="status"><span className="dot"/><div><b>Some tracking updates are delayed.</b><span> Last known positions remain visible. Check each bird’s observation age before drafting.</span></div><button onClick={refresh}>Check again ↻</button></div>}
 {message&&<div key={message} role="status" className="message"><span>{message}</span><button aria-label="Dismiss message" onClick={()=>setMessage('')}>×</button><span className="message-countdown" aria-hidden="true"/></div>}
 {(view==='map'||view==='birds')&&<><div className="toolbar"><div className="search-controls"><input aria-label="Search storks" placeholder="Search name, ring or country…" value={query} onChange={e=>setQuery(e.target.value)}/><SortFilter value={sort} onChange={setSort}/><ListFilter/>{['success','arrival'].includes(sort)&&rankingsLoading&&<span className="ranking-status" role="status">Loading rankings…</span>}{['success','arrival'].includes(sort)&&rankingsError&&<button className="ranking-status" onClick={()=>setRankingsRetry(v=>v+1)}>Retry rankings</button>}<div className="scouting-filters"><label className="check"><input type="checkbox" checked={only} onChange={e=>setOnly(e.target.checked)}/>Eligible</label><label className="check starred-filter" title="Starred storks"><input aria-label="Starred storks" type="checkbox" checked={starredOnly} onChange={e=>setStarredOnly(e.target.checked)}/><StarSymbol/></label></div></div>{deadline}</div>
 {view==='map'?<div ref={mapExplorerRef} className="explorer interactive-explorer">{map}<aside ref={scoutingListRef} className="birdlist"><div className="listhead">SCOUTING REPORT <span>{filtered.length} birds</span></div>{filtered.map(b=><button key={b.id} className={selected?.id===b.id?"birdrow birdrow-selected":"birdrow"} aria-pressed={selected?.id===b.id} onClick={()=>choose(b)}><Portrait bird={b}/><span className="birdrow-content"><span className="birdrow-heading"><b>{short(b.name)}{starred.includes(b.id)&&<span className="scouting-star" aria-label="Starred"> ★</span>}<BirdListMarks birdId={b.id}/></b>{scoutingStat(b)}</span><small>{birdStatus(b,now)!=='active'?birdStatus(b,now)+' · ':''}{b.country} · {prefs.distance(b.distanceToGermanyMiles)} {prefs.units} to Germany · Seen {ageLabel(b.latestValidFixUtc,now)}</small></span><span>›</span></button>)}{!filtered.length&&<p className="empty">{loaded?'No birds on this board. Try another search or turn off a filter.':'Loading the scouting board…'}</p>}</aside></div>:<ScoutProfiles birds={filtered} now={now} revision={syncInfo.asOf} starred={starred} onStar={toggleStar} onMap={choose} orderKey={JSON.stringify([sort,query,only,starredOnly,scoutLists.filter,rankingsRetry,!!rankings])} orderRef={scoutOrderRef} waiting={['success','arrival'].includes(sort)&&!rankings&&!rankingsError} loaded={loaded}/>}</>}
 {view==='leagues'&&<LeagueHub selectedBirdId={selected?.id} teamColors={colors} starred={starred} sort={sort} setSort={setSort} rankings={rankings?.values} rankingsLoading={rankingsLoading} rankingsError={rankingsError} onRetryRankings={()=>setRankingsRetry(v=>v+1)} scoutingStat={scoutingStat} auth={auth} signedIn={signedIn} busy={busy} name={name} setName={setName} invite={invite} setInvite={setInvite} leagues={leagues} leagueId={leagueId} userId={userId} leagueError={leagueError} onRetry={refreshLeagues} onSelectLeague={(id:string)=>{closeProfile();setLeagueId(id);setTeam('all');}} action={action} birds={birds} now={now} onBird={choose} team={team} setTeam={(id:string)=>{closeProfile();setTeam(id);}} map={map}/>}
 {(view==='map'||view==='leagues')&&profile}
 {view==='rules'&&<HowToPlay/>}
 <footer><details id="data-attribution"><summary>Data sources & attribution</summary><p>{seed.attribution.creators}</p><p>Race and distance boundary: © <a href="https://www.bkg.bund.de">BKG</a> (2026), <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. <a href="https://sgx.geodatenzentrum.de/web_public/gdz/datenquellen/datenquellen_vg25.pdf">Data sources</a>. VG25 features selected and combined without simplification; offshore and technical lake partitions excluded.</p><p>{seed.attribution.changes} Distances and trails are derived; historical records are retained separately from recent-location snapshots. Sampled trails and available-track distances are not lifetime measurements.</p>{seed.studies.map(s=><p key={s.studyId}><a href={s.sourceUrl} target="_blank" rel="noreferrer">{s.study}</a> · <a href={s.licenseUrl}>{s.license}</a></p>)}</details><details id="tracking-status" className="tracking-details"><summary>Tracking & data status</summary><p>{syncInfo.sources?.length||0}/8 sources connected. {syncInfo.sources?.length?'Oldest source check: '+fmt(syncInfo.asOf):'Waiting for tracking data.'} Updates every {syncInfo.policy?.intervalHours||6} hours; new birds checked daily.</p></details><a className="privacy-link" href="/?view=settings&section=privacy">Privacy & account data</a></footer></main>

 </>;
}






