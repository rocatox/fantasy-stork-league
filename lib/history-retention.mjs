import {seasonWindow} from './race.mjs';
export const RETENTION_VERSION=1,DAY=86400000;
export function retainHistory(rows,{now=Date.now(),heldYears=[],pinnedIds=[]}={}){
 const held=new Set(heldYears),pins=new Set(pinnedIds),buckets=new Set();let compactAfter=Infinity;
 const kept=rows.filter(r=>{
  const t=Date.parse(r[0]),year=new Date(t).getUTCFullYear();
  // Older study history predates the app's seasonWindow validation range.
  const season=year>=2026&&year<=2100?seasonWindow(year):null;
  const inSeason=season&&t>=season.start&&t<season.end;
  let until=t+30*DAY;
  if(inSeason)until=Math.max(until,held.has(year)?now+DAY:season.end+30*DAY);
  if(pins.has(String(r[1])))return true;
  if(now<=until){compactAfter=Math.min(compactAfter,until+1);return true;}
  if(!r[6])return false;
  const key=String(r[4])+':'+Math.floor(t/300000);
  if(buckets.has(key))return false;buckets.add(key);return true;
 });
 return {rows:kept,retentionVersion:RETENTION_VERSION,resolution:'five-minute-archive/full-protected-windows',compactAfter:Number.isFinite(compactAfter)?compactAfter:null};
}
