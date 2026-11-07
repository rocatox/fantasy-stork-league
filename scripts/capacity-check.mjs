const origin=process.env.APP_ORIGIN||'https://storkleague.fans',secret=process.env.SYNC_SECRET;
if(!secret||origin!=='https://storkleague.fans')throw Error('Missing capacity-check configuration');
const r=await fetch(origin+'/api/capacity',{method:'POST',headers:{Authorization:'Bearer '+secret},redirect:'error',signal:AbortSignal.timeout(30000)});
if(!r.ok)throw Error('Capacity check HTTP '+r.status);
const {checkedAt,databases,email,warnings}=await r.json();
console.log(JSON.stringify({checkedAt,databases,email}));
for(const w of warnings)console.log('::'+(w.level==='critical'?'error':'warning')+'::'+w.message);
if(warnings.some(w=>w.level==='critical'))process.exitCode=1;
