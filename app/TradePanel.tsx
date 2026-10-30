import {useEffect,useState} from 'react';
import {birdName} from '../lib/bird-name.mjs';
import Portrait from './Portrait';
export default function TradePanel({league,userId,birds,busy,action}:any){
 const [to,setTo]=useState(''),[offer,setOffer]=useState<string[]>([]),[request,setRequest]=useState<string[]>([]);
 const trades=league.trades||[],pending=trades.filter((t:any)=>t.status==='pending'&&(t.from===userId||t.to===userId)),outgoing=pending.filter((t:any)=>t.from===userId).length;
 const mine=league.picks.filter((p:any)=>p.userId===userId&&!p.replacementRequired),theirs=league.picks.filter((p:any)=>p.userId===to&&!p.replacementRequired);
 const members=league.members.filter((m:any)=>m.id!==userId),name=(id:string)=>league.members.find((m:any)=>m.id===id)?.name||'Player';
 const rosterKey=league.picks.map((p:any)=>p.birdId+':'+p.userId+':'+!!p.replacementRequired).join('|');
 useEffect(()=>{setOffer(ids=>ids.filter(id=>mine.some((p:any)=>p.birdId===id)));setRequest(ids=>ids.filter(id=>theirs.some((p:any)=>p.birdId===id)));},[rosterKey,to]);
 const bird=(id:string)=>birds.find((b:any)=>b.id===id)||league.picks.find((p:any)=>p.birdId===id)?.bird||{name:id};
 const names=(ids:string[])=>ids.map(id=>birdName(bird(id).name)).join(', ');
 const toggle=(set:any,id:string)=>set((ids:string[])=>ids.includes(id)?ids.filter(x=>x!==id):[...ids,id]);
 const choices=(picks:any[],selected:string[],set:any)=>picks.map(p=>{const b=bird(p.birdId);return <label className="trade-choice" key={p.birdId}><input type="checkbox" checked={selected.includes(p.birdId)} onChange={()=>toggle(set,p.birdId)} disabled={busy}/><Portrait bird={b} className="league-portrait"/><span>{birdName(b.name)}</span></label>;});
 return <section className="league-section trade-panel"><h4>Trading is open</h4><p>Agree a swap before January 15, 11:59 p.m. Eastern. Unequal trades are allowed, including rosters over six storks.</p>
 <form onSubmit={async e=>{e.preventDefault();if(await action('proposeTrade',{to,offer,request})){setOffer([]);setRequest([]);}}}>
 <div className="trade-heading"><label>Trade with<select value={to} onChange={e=>{setTo(e.target.value);setRequest([]);}} required><option value="">Choose a player</option>{members.map((m:any)=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label><span>{outgoing}/3 pending proposals</span></div>
 {to&&<div className="trade-rosters"><fieldset><legend>You give · {offer.length}</legend>{choices(mine,offer,setOffer)}{!mine.length&&<p>No storks available to trade.</p>}</fieldset><fieldset><legend>You receive · {request.length}</legend>{choices(theirs,request,setRequest)}{!theirs.length&&<p>No storks available to trade.</p>}</fieldset></div>}
 <button className="primary" disabled={busy||outgoing>=3||!to||!offer.length||!request.length}>Propose trade</button>{outgoing>=3&&<p className="league-help">Cancel a pending proposal before sending another.</p>}</form>
 {pending.length>0&&<div className="trade-proposals"><h4>Pending trades</h4>{pending.map((t:any)=>{const incoming=t.to===userId;return <article className="trade-card" key={t.id}><b>{incoming?'From '+name(t.from):'To '+name(t.to)}</b><p><strong>You give:</strong> {names(incoming?t.request:t.offer)}</p><p><strong>You receive:</strong> {names(incoming?t.offer:t.request)}</p><div className="trade-actions">{incoming?<><button className="primary" disabled={busy} onClick={()=>action('acceptTrade',{tradeId:t.id})}>Accept trade</button><button disabled={busy} onClick={()=>action('declineTrade',{tradeId:t.id})}>Decline</button></>:<button disabled={busy} onClick={()=>action('cancelTrade',{tradeId:t.id})}>Cancel proposal</button>}</div></article>;})}</div>}
 {trades.some((t:any)=>t.status!=='pending'&&(t.from===userId||t.to===userId))&&<details className="trade-history"><summary>Recent trade activity</summary>{trades.filter((t:any)=>t.status!=='pending'&&(t.from===userId||t.to===userId)).slice(-10).reverse().map((t:any)=><p key={t.id}><b>{name(t.from)} ↔ {name(t.to)} · {t.status}</b><br/>{names(t.offer)} ↔ {names(t.request)}{t.reason&&<><br/>{t.reason}</>}</p>)}</details>}
 </section>;
}
