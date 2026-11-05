import {trackPoints} from './map-geometry.mjs';
import {transferableTrail,overviewTrail} from './prepared-trail.mjs';
import {loadTimeline} from './timeline-cache.mjs';
import {windowPoints} from './league-trails.mjs';
const cancelled=new Set<number>(),running=new Set<number>();
let priorityState={until:0,active:0};
async function idle(background:boolean,requestId:number){while(background&&(priorityState.active||Date.now()<priorityState.until)){if(cancelled.has(requestId))throw Error('Cancelled');await new Promise(resolve=>setTimeout(resolve,80));}if(cancelled.has(requestId))throw Error('Cancelled');}
// Fetching, JSON decoding, sorting and GPS screening run off the UI thread.
self.onmessage=async({data})=>{
 if(data.cancel){if(running.has(data.cancel))cancelled.add(data.cancel);return;}
 if(data.priorityState){priorityState=data.priorityState;return;}
 const {requestId,bird,start,end,background,overview}=data;
 running.add(requestId);
 try{await idle(background,requestId);const history=await loadTimeline(bird.id,overview?start:null,overview?end:null);await idle(background,requestId);const points=start===null?trackPoints(history.points):windowPoints([...history.points,[bird.longitude,bird.latitude,bird.latestValidFixUtc]],start,end);const trail=overview?overviewTrail(points,overview==='detail'):transferableTrail(points);
 const arrays=[trail.points,[],...trail.lods.map(l=>l.segments)];
 self.postMessage({requestId,header:{segmentsFromLod:0,bounds:trail.bounds,tolerances:trail.lods.map(l=>l.tolerance)}});
 // Deliver bounded chunks instead of one large structured-clone task on the UI.
 for(let field=0;field<arrays.length;field++)for(let offset=0;offset<arrays[field].length;offset+=1000){
  await idle(background,requestId);
  self.postMessage({requestId,field,chunk:arrays[field].slice(offset,offset+1000)});
  await new Promise(resolve=>setTimeout(resolve,16));
 }
 self.postMessage({requestId,complete:true});}
 catch{if(!cancelled.has(requestId))self.postMessage({requestId,error:'Could not load recent trails.'});}
 finally{running.delete(requestId);cancelled.delete(requestId);}
};
