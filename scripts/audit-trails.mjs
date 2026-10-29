import {writeFile} from 'node:fs/promises';
import {trackPoints,implausibleLeg,distanceKm,trailSegments,replayPosition} from '../lib/map-geometry.mjs';
const origin=process.argv[2]||'https://storkleague.fans';
const output=process.argv[3]||'.wrangler/trail-audit.json';
async function get(url){for(let attempt=0;attempt<3;attempt++){try{const r=await fetch(url,{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('HTTP '+r.status);return await r.json();}catch(e){if(attempt===2)throw e;}}}
const roster=await get(origin+'/api/birds'),results=[];
for(const bird of roster.birds){
 try{
 const data=await get(origin+'/api/history?timeline=1&bird='+encodeURIComponent(bird.id));
 const raw=data.points,points=trackPoints(raw),kept=new Set(points.map(p=>JSON.stringify(p)));
 const removed=raw.filter(p=>!kept.has(JSON.stringify(p)));
 const jumps=[];for(let i=1;i<points.length;i++)if(implausibleLeg(points[i-1],points[i]))jumps.push({from:points[i-1],to:points[i],km:distanceKm(points[i-1],points[i])});
 const segments=trailSegments(points);let unsafeDrawn=0,unsafeReplay=0;
 for(const s of segments)if(implausibleLeg(points[s.index],points[s.index+1]))unsafeDrawn++;
 for(let i=1;i<points.length;i++)if(implausibleLeg(points[i-1],points[i])){const t=(Date.parse(points[i-1][2])+Date.parse(points[i][2]))/2;if(replayPosition(points,t)?.canInterpolate)unsafeReplay++;}
 const result={id:bird.id,name:bird.name,records:data.records,points:raw.length,removed,remainingJumps:jumps,unsafeDrawn,unsafeReplay};results.push(result);console.log(JSON.stringify({name:bird.name,points:raw.length,removed:removed.length,jumps:jumps.length,unsafeDrawn,unsafeReplay}));
 }catch(e){results.push({id:bird.id,name:bird.name,error:String(e)});console.error(bird.name,String(e));}
}
await writeFile(output,JSON.stringify({auditedAt:new Date().toISOString(),origin,scope:'Public monthly timeline previews, not every archived raw fix',results},null,2));
if(results.some(r=>r.error||r.unsafeDrawn||r.unsafeReplay))process.exitCode=1;

