import {standings} from './race.mjs';
export function cycleStandings(event,settled,createdAt,closedAt){
 const current=standings(event.league,event.results,createdAt);
 const final=standings(settled.league,settled.results,closedAt);
 if(event.cycleFinal)return final;
 const byId=new Map(final.birds.map(b=>[b.birdId,b]));
 // Preserve every captured arrival/retraction and migration signal. Only points
 // come from the reconciled cycle, and never attach points to a different arrival.
 current.dataPending=final.dataPending;current.dataStale=final.dataStale;
 current.birds=current.birds.map(b=>{const f=byId.get(b.birdId);const match=!!f&&(f.arrival?.observedAt||null)===(b.arrival?.observedAt||null);
  return {...b,points:match?f.points:0,notificationPointsPending:!match};});
 // Final results belong to the terminal snapshot, never an intermediate import.
 if(current.status==='complete')current.status='reconciling';
 return current;
}
