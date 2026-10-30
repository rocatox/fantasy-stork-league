import {cutoff} from './rules.mjs';
export const TRADE_ACTIONS=['proposeTrade','acceptTrade','cancelTrade','declineTrade'];
export const tradingOpen=(league,now=Date.now())=>league.status==='ready'&&now<cutoff(league.year);
// Draft-distance eligibility is not rechecked for birds already owned by this league.
export function possibleTrade(league,trade){
 const owned=(ids,user)=>Array.isArray(ids)&&ids.length>0&&new Set(ids).size===ids.length&&ids.every(id=>league.picks.some(p=>p.birdId===id&&p.userId===user&&!p.replacementRequired));
 return trade.from!==trade.to&&league.members.some(m=>m.id===trade.from)&&league.members.some(m=>m.id===trade.to)&&owned(trade.offer,trade.from)&&owned(trade.request,trade.to);
}
export function cleanTrades(league,now=Date.now()){
 let changed=false;
 for(const trade of league.trades||[])if(trade.status==='pending'&&(!tradingOpen(league,now)||!possibleTrade(league,trade))){
  trade.status='cancelled';trade.reason=tradingOpen(league,now)?'Roster changed or a stork requires replacement':'Trading window closed';trade.resolvedAt=new Date(now).toISOString();changed=true;
 }
 return changed;
}
// Mutates only a request-local state; the endpoint commits it with a revision + deadline guard.
export function applyTrade(league,user,action,input,now=Date.now()){
 if(!tradingOpen(league,now))throw Error('Trading opens after the draft and closes January 15 at 11:59 p.m. Eastern');
 cleanTrades(league,now);league.trades||=[];
 if(action==='proposeTrade'){
  const valid=ids=>Array.isArray(ids)&&ids.length>0&&ids.length<=48&&ids.every(id=>typeof id==='string'&&id.length<=500)&&new Set(ids).size===ids.length;
  if(!valid(input.offer)||!valid(input.request)||typeof input.to!=='string')throw Error('Choose at least one stork from each roster, without duplicates');
  if(league.trades.filter(t=>t.from===user&&t.status==='pending').length>=3)throw Error('You already have three pending trade proposals');
  const trade={id:crypto.randomUUID(),from:user,to:input.to,offer:input.offer,request:input.request,status:'pending',createdAt:new Date(now).toISOString()};
  if(!possibleTrade(league,trade))throw Error('These storks are no longer available to trade');
  league.trades.push(trade);return;
 }
 const trade=league.trades.find(t=>t.id===input.tradeId);
 if(!trade||trade.status!=='pending')throw Error('This trade is no longer pending');
 if(action==='cancelTrade'){
  if(trade.from!==user)throw Error('Only the proposer can cancel this trade');trade.status='cancelled';trade.reason='Cancelled by proposer';
 }else if(action==='declineTrade'){
  if(trade.to!==user)throw Error('Only the recipient can decline this trade');trade.status='declined';
 }else if(action==='acceptTrade'){
  if(trade.to!==user)throw Error('Only the recipient can accept this trade');
  if(!possibleTrade(league,trade))throw Error('A roster has changed; this trade cannot be accepted');
  for(const pick of league.picks){if(trade.offer.includes(pick.birdId))pick.userId=trade.to;else if(trade.request.includes(pick.birdId))pick.userId=trade.from;}
  trade.status='accepted';
 }else throw Error('Unknown trade action');
 trade.resolvedAt=new Date(now).toISOString();cleanTrades(league,now);
}
