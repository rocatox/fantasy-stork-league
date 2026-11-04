import {trackPoints} from './map-geometry.mjs';
import {transferableTrail} from './prepared-trail.mjs';
import {loadTimeline} from './timeline-cache.mjs';
import {windowPoints} from './league-trails.mjs';
let priorityState={until:0,active:0};
async function idle(background:boolean){while(background&&(priorityState.active||Date.now()<priorityState.until))await new Promise(resolve=>setTimeout(resolve,80));}
// Fetching, JSON decoding, sorting and GPS screening run off the UI thread.
self.onmessage=async({data})=>{
 if(data.priorityState){priorityState=data.priorityState;return;}
 const {requestId,bird,start,end,background}=data;
 try{await idle(background);const history=await loadTimeline(bird.id);await idle(background);const points=start===null?trackPoints(history.points):windowPoints([...history.points,[bird.longitude,bird.latitude,bird.latestValidFixUtc]],start,end);const trail=transferableTrail(points);
 const arrays=[trail.points,trail.segments,...trail.lods.map(l=>l.segments)];
 self.postMessage({requestId,header:{bounds:trail.bounds,tolerances:trail.lods.map(l=>l.tolerance)}});
 // Deliver bounded chunks instead of one large structured-clone task on the UI.
 for(let field=0;field<arrays.length;field++)for(let offset=0;offset<arrays[field].length;offset+=1000){
  await idle(background);
  self.postMessage({requestId,field,chunk:arrays[field].slice(offset,offset+1000)});
  await new Promise(resolve=>setTimeout(resolve,16));
 }
 self.postMessage({requestId,complete:true});}
 catch{self.postMessage({requestId,error:'Could not load recent trails.'});}
};
