// Recurring reads stop while hidden; focus/visibility events coalesce and restore
// fresh data without overlapping requests. Explicit user writes remain separate.
export function visiblePoll(run,{document:doc=document,window:win=window,interval=()=>Number(60000),now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 let stopped=false,pending=false,timer,last=-Infinity;
 const schedule=()=>{clearTimer(timer);if(!stopped&&doc.visibilityState==='visible')timer=setTimer(()=>tick(false),interval());};
 async function tick(returning){
  if(stopped||doc.visibilityState!=='visible')return;
  if(pending)return;
  if(returning&&now()-last<1000){schedule();return;}
  pending=true;last=now();
  try{await run();}catch{/* callers own their error UI */}finally{pending=false;schedule();}
 }
 const visibility=()=>{clearTimer(timer);if(doc.visibilityState==='visible')void tick(true);};
 const focus=()=>void tick(true);
 doc.addEventListener('visibilitychange',visibility);win.addEventListener('focus',focus);void tick(false);
 return()=>{stopped=true;clearTimer(timer);doc.removeEventListener('visibilitychange',visibility);win.removeEventListener('focus',focus);};
}
