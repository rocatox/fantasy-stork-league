// Match the existing trade-history audience; include that manager's pool swaps.
export function leagueActivity(league,userId){
 const trades=(league.trades||[]).filter(t=>t.status!=='pending'&&(t.from===userId||t.to===userId)).map(t=>({kind:'trade',key:'trade:'+t.id,at:t.resolvedAt||t.createdAt,data:t}));
 const swaps=(league.swaps||[]).map((s,i)=>({kind:'swap',key:'swap:'+i,at:s.swappedAt,data:s})).filter(e=>(e.data.replacement?.userId||e.data.original?.userId)===userId);
 return [...trades,...swaps].sort((a,b)=>(Date.parse(b.at)||0)-(Date.parse(a.at)||0)||a.key.localeCompare(b.key));
}
