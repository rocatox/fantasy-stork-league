export function createMapPriority(now=()=>Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms))){
 let until=now()+1200,active=0;const listeners=new Set();
 const state=()=>({until,active});const notify=()=>listeners.forEach(fn=>fn(state()));
 const hold=(ms=1200)=>{const next=now()+ms;if(next>until){until=next;notify();}};
 return {state,hold,subscribe(fn){listeners.add(fn);fn(state());return()=>listeners.delete(fn);},begin(){active++;notify();let done=false;return()=>{if(done)return;done=true;active--;until=Math.max(until,now()+1200);notify();};},async wait(signal){while(active||now()<until){if(signal?.aborted)throw new DOMException('Cancelled','AbortError');await sleep(active?100:Math.min(100,Math.max(16,until-now())));}if(signal?.aborted)throw new DOMException('Cancelled','AbortError');}};
}
export const mapPriority=createMapPriority();
