import {loadTimeline} from './timeline-cache.mjs';
import {windowPoints} from './league-trails.mjs';
// Fetching, JSON decoding, sorting and GPS screening run off the UI thread.
self.onmessage=async({data})=>{
 const {requestId,bird,start,end}=data;
 try{const history=await loadTimeline(bird.id);const points=windowPoints([...history.points,[bird.longitude,bird.latitude,bird.latestValidFixUtc]],start,end);self.postMessage({requestId,points});}
 catch{self.postMessage({requestId,error:'Could not load recent trails.'});}
};
