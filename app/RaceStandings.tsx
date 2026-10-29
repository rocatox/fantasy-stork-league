import Portrait from './Portrait';
import {birdStatus} from '../lib/bird-lifecycle.mjs';
import './RaceStandings.css';
const date=(value:string)=>new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
const labels:any={'not-started':'Season starts January 16',racing:'Race in progress',reconciling:'Season ended · reconciling results',complete:'Season complete','draft-incomplete':'Complete your draft to enter the race',disbanded:'League disbanded'};
export default function RaceStandings({race,birds,onBird}:{race:any,birds:any[],onBird:(bird:any)=>void}){
 if(!race)return <section className="race-standings"><h3>Standings</h3><p>Loading standings…</p></section>;
 if(!race.teams.length)return <section className="race-standings"><h3>Standings</h3><p>{labels[race.status]}</p></section>;
 return <section className="race-standings" aria-label="League standings">
  <div className="race-heading"><h3>{race.year} standings</h3><span className="badge">{labels[race.status]}</span></div>
  {race.provisional&&<p role="status">Provisional results. New arrivals or corrections reopen a 72-hour review period.</p>}
  {(race.dataPending||race.dataStale)&&race.status!=='not-started'&&<p role="status">{race.dataPending?'Some birds are awaiting their first season check.':'Some season checks are overdue.'} Previous results remain visible; standings cannot be finalized yet.</p>}
  {race.checkedAt&&<p className="fine">All checked birds reviewed through {date(race.checkedAt)}.</p>}
  <div className="race-table-wrap"><table><caption>Team standings</caption><thead><tr><th scope="col">Place</th><th scope="col">Player</th><th scope="col">Arrived</th><th scope="col">Points</th></tr></thead><tbody>{race.teams.map((t:any)=><tr key={t.userId}><td>{race.status==='not-started'?'—':t.rank}</td><th scope="row">{t.name}</th><td>{t.arrivals}</td><td>{t.points}</td></tr>)}</tbody></table></div>
  <div className="race-table-wrap"><table><caption>Bird arrivals</caption><thead><tr><th scope="col">Place</th><th scope="col">Stork</th><th scope="col">First recorded arrival</th><th scope="col">Points</th></tr></thead><tbody>{race.birds.map((r:any)=>{const bird=birds.find(b=>b.id===r.birdId);return <tr key={r.birdId}><td>{r.rank??'—'}</td><th scope="row">{bird?<button className="race-bird" onClick={()=>onBird(bird)}><Portrait bird={bird} className="league-portrait"/><span>{bird.name}</span></button>:r.bird?.name||r.birdId}{bird&&birdStatus(bird)!=='active'&&<small>{birdStatus(bird)==='deceased'?'Deceased':'Inactive'}</small>}<small>{race.teams.find((t:any)=>t.userId===r.userId)?.name}</small></th><td>{r.arrival?<><time dateTime={r.arrival.observedAt}>{date(r.arrival.observedAt)}</time><small>Corroborated GPS arrival inside Germany</small></>:({'replacement-available':'Replacement available','not-replaced':'Not replaced — zero points','not-started':'Not started','awaiting-data':'Awaiting data',nonfinisher:'No qualifying arrival',racing:'Still racing'} as any)[r.status]}</td><td>{r.points}</td></tr>;})}</tbody></table></div>
  <p className="fine">Only this league’s drafted birds determine points. Equal observation times share the points for tied places. No recorded arrival by the end of June 30 Eastern earns zero; a missing signal does not prove that a bird never reached Germany. Late observations and source corrections can revise results.</p>
 </section>;
}
