import {trailOpacity} from '../lib/league-trails.mjs';
import {birdName} from '../lib/bird-name.mjs';
import {createPortal} from 'react-dom';
import {nearbyMarkers} from '../lib/marker-hit.mjs';
import {useEffect,useMemo,useRef,useState,useId} from 'react';
import countries from '../data/map.json';
import portraitCircles from '../data/portrait-circles.json';
import {mercator,fitCamera,trackPoints,observationIndex,trailSegments,replayPosition} from '../lib/map-geometry.mjs';
import './MigrationMap.css';
const geography=countries.map((c:any)=>({...c,paths:c.rings.map((r:any)=>r.map((p:any)=>mercator(p).join(',')).join(' '))}));
const baseMap=(geography.map((c:any,i:number)=><g key={i}>{c.paths.map((p:string,j:number)=><g key={j}><polygon points={p} fill="#faf9f4" stroke={c.code==='DE'?'none':'#b9c3d5'} strokeWidth=".7" vectorEffect="non-scaling-stroke"/>{c.code==='DE'&&<polygon points={p} fill="#c29a34" fillOpacity=".16" stroke="none" vectorEffect="non-scaling-stroke"/>}</g>)}</g>));
const germany=countries.filter((c:any)=>c.code==='DE').flatMap((c:any)=>c.rings.flat());
const date=(s:string|number)=>new Date(s).toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'UTC'})+' UTC';
function SelectedMarker({bird,x,y,units}:{bird:any,x:number,y:number,units:number}){
 const clip=useId().replace(/:/g,'');const r=18*units;
 const [cx,cy,sourceRadius]=(portraitCircles as Record<string,number[]>)[String(bird.portraitId)]||[128,128,128];
 const scale=r/sourceRadius*1.02;
 return <g className="selected-portrait-marker" pointerEvents="none"><defs><clipPath id={clip}><circle cx={x} cy={y} r={r}/></clipPath></defs><circle cx={x} cy={y} r={23*units} fill="#202b4d" fillOpacity=".22"/><circle cx={x} cy={y} r={r} fill="#202b4d"/>{bird.portraitId&&<image href={'/stork-portraits/stork-'+String(bird.portraitId).padStart(2,'0')+'.webp'} x={x-cx*scale} y={y-cy*scale} width={256*scale} height={256*scale} preserveAspectRatio="xMidYMid slice" clipPath={'url(#'+clip+')'}/>}<circle cx={x} cy={y} r={r} fill="none" stroke="#202b4d" strokeWidth="3" vectorEffect="non-scaling-stroke"/></g>;
}
export default function MigrationMap({birds,trail,color,onBird,replayStatus,onRetry,league=false,timelineTarget,externalTimeline=false,leagueTracks,leagueWindow,leagueLoading=false,leagueFailed=false}:{birds:any[],trail:any,color:(b:any)=>string,onBird:(b:any)=>void,replayStatus:string,onRetry:()=>void,league?:boolean,timelineTarget?:HTMLElement|null,externalTimeline?:boolean,leagueTracks?:any[],leagueWindow?:{start:number,end:number},leagueLoading?:boolean,leagueFailed?:boolean}){
 const host=useRef<HTMLDivElement>(null),svg=useRef<SVGSVGElement>(null),pointers=useRef(new Map<number,{x:number,y:number}>()),gesture=useRef<any>(null),didDrag=useRef(false),tapBird=useRef<any>(null),suppressClick=useRef(false);
 const [size,setSize]=useState({w:800,h:610}),[camera,setCamera]=useState(()=>fitCamera(germany,800,610)),[time,setTime]=useState(0),[playing,setPlaying]=useState(false),[speed,setSpeed]=useState(7);
 const [follow,setFollow]=useState(false);
 const group=!!leagueTracks,gradientPrefix=useId().replace(/:/g,'');
 const zoomFrame=useRef(0);
 function stopZoom(){cancelAnimationFrame(zoomFrame.current);zoomFrame.current=0;}
 useEffect(()=>()=>stopZoom(),[]);
 function animateCamera(target:typeof camera,duration=480){
  stopZoom();
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){setCamera(target);return;}
  const start=camera,began=performance.now();
  function tick(now:number){
   const t=Math.min(1,(now-began)/duration),ease=t*t*(3-2*t);
   setCamera({x:start.x+(target.x-start.x)*ease,y:start.y+(target.y-start.y)*ease,units:start.units*Math.pow(target.units/start.units,ease)});
   if(t<1)zoomFrame.current=requestAnimationFrame(tick);else zoomFrame.current=0;
  }
  zoomFrame.current=requestAnimationFrame(tick);
 }
 const points=useMemo(()=>group?[...new Map(leagueTracks!.flatMap(t=>t.points).map(p=>[p[2],p])).values()].sort((a:any,b:any)=>Date.parse(a[2])-Date.parse(b[2])) as any[]:trackPoints(trail?.history||[]),[trail?.history,leagueTracks]);
 const boundsKey=JSON.stringify(birds.map(b=>[b.longitude,b.latitude]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]));
 const defaultBounds=useMemo(()=>[...germany,...JSON.parse(boundsKey).filter((p:any)=>Number.isFinite(p[0])&&Number.isFinite(p[1]))],[boundsKey]);
 const replay=group||!!trail?.replay&&points.length>0;
 const first=group?leagueWindow!.start:points.length?Date.parse(points[0][2]):0,last=group?leagueWindow!.end:points.length?Date.parse(points.at(-1)[2]):0;
 const cursor=Math.max(first,Math.min(last,time||last)),index=observationIndex(points,cursor),point=points[index];
 const selectedPoints=group?leagueTracks!.find(t=>t.bird.id===trail?.id)?.points||[]:points;
 const position=replayPosition(selectedPoints,cursor);
 const teamSegments=useMemo(()=>leagueTracks?.map(t=>({...t,segments:trailSegments(t.points)}))||[],[leagueTracks]);
 const displayedBirds=group?leagueTracks!.flatMap(t=>{if(!t.points.length||cursor<Date.parse(t.points[0][2]))return [];const p=replayPosition(t.points,cursor);return p?[{...t.bird,longitude:p.longitude,latitude:p.latitude,replayGap:p.gap}]:[];}).concat(trail?.id?birds.filter(b=>b.id!==trail.id):[]):birds.filter(b=>!replay||b.id!==trail?.id);
 const anyGap=group?displayedBirds.some(b=>b.replayGap):position?.gap;
 const segments=useMemo(()=>group?[]:trailSegments(points),[points,group]);
 const routeBounds=useMemo(()=>group?[...(!trail?.id?germany:[]),...leagueTracks!.flatMap(t=>t.points)]:points,[leagueTracks,trail?.id,points,group]);
 // Separate strokes composite independently, making repeat visits and crossings darker.
 const trailStrokes=useMemo(()=>segments.filter(s=>!replay||s.index!==index).map(s=><path key={s.index} d={s.path} fill="none" stroke={replay?(s.index<index?'#a77c16':'#73819c'):'#c29a34'} strokeOpacity=".7" strokeWidth={replay&&s.index<index?3:2} strokeLinecap="round" vectorEffect="non-scaling-stroke"/>),[segments,replay,index]);
 useEffect(()=>{const el=host.current;if(!el)return;const observer=new ResizeObserver(([entry])=>setSize({w:entry.contentRect.width,h:entry.contentRect.height}));observer.observe(el);return()=>observer.disconnect();},[]);
 // Fit a newly chosen track; scrubbing moves the camera only when Follow bird is on.
 const trackKey=group?'league:'+String(trail?.id||'all'):trail?.id+':'+Boolean(trail?.replay);
 useEffect(()=>{setTime(last);setPlaying(false);},[trackKey]);
 const previousLast=useRef(last);
 useEffect(()=>{const oldLast=previousLast.current;previousLast.current=last;setTime(t=>!t||t>=oldLast?last:Math.max(first,Math.min(last,t)));},[first,last]);
 useEffect(()=>{if(!trail?.id)setFollow(false);},[trail?.id]);
 useEffect(()=>{if(follow&&position&&cursor>=Date.parse(selectedPoints[0]?.[2])){stopZoom();setCamera(c=>({...c,x:position.xy[0],y:position.xy[1]}));}},[follow,cursor,trail?.id]);
 useEffect(()=>{
  if(!playing||!replay||first===last)return;
  let cursor=Math.max(first,Math.min(last,time||last)),previous=performance.now(),frame=0;
  function tick(now:number){
   if(document.hidden){setPlaying(false);return;}
   const elapsed=Math.min(100,now-previous);previous=now;
   cursor=Math.min(last,cursor+elapsed*speed*86400);setTime(cursor);
   if(cursor>=last){setPlaying(false);return;}frame=requestAnimationFrame(tick);
  }
  frame=requestAnimationFrame(tick);
  const hidden=()=>{if(document.hidden)setPlaying(false);};document.addEventListener('visibilitychange',hidden);
  return()=>{cancelAnimationFrame(frame);document.removeEventListener('visibilitychange',hidden);};
 },[playing,speed,replay,first,last,points]);
 function seek(t:number){setPlaying(false);setTime(t);}
 function togglePlay(){if(playing){setPlaying(false);return;}if(cursor>=last)setTime(first);setPlaying(true);}
 // Hold the current view while history loads, then ease into the complete trail.
 useEffect(()=>{stopZoom();if(!group&&trail?.replay&&!points.length)return;const target=fitCamera(points.length?routeBounds:defaultBounds,size.w,size.h);if(points.length)animateCamera(target,750);else setCamera(target);},[trackKey,group?points.length:last,size.w,size.h,defaultBounds]);
 function reset(){setPlaying(false);animateCamera(fitCamera(points.length?routeBounds:defaultBounds,size.w,size.h),750);}
 function zoom(factor:number){stopZoom();setCamera(c=>({...c,units:Math.max(.00001,Math.min(3,c.units*factor))}));}
 function startGesture(){const p=[...pointers.current.values()];gesture.current={camera,center:p.length===2?{x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2}:p[0],distance:p.length===2?Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y):0};}
 function chooseMarker(b:any){onBird(birds.find(original=>original.id===b.id)||b);}
 function birdAt(clientX:number,clientY:number){
  const rect=svg.current?.getBoundingClientRect();if(!rect)return [];
  const x=camera.x+(clientX-rect.left-size.w/2)*camera.units,y=camera.y+(clientY-rect.top-size.h/2)*camera.units;
  return nearbyMarkers(displayedBirds.map(bird=>{const [x,y]=mercator([bird.longitude,bird.latitude]);return {bird,x,y};}),x,y,22*camera.units);
 }
 function selectAt(x:number,y:number){
  const choices=birdAt(x,y);if(!choices.length)return;
  if(choices.length>1&&camera.units>.00001){
   const rect=svg.current!.getBoundingClientRect();setPlaying(false);
   animateCamera({x:camera.x+(x-rect.left-size.w/2)*camera.units,y:camera.y+(y-rect.top-size.h/2)*camera.units,units:Math.max(.00001,camera.units*.3)});
  }else chooseMarker(choices[0]);
 }
 function down(e:React.PointerEvent<SVGSVGElement>){
  if(e.button!==0)return;
  stopZoom();
  if(!pointers.current.size){didDrag.current=false;suppressClick.current=false;}
  const target=(e.target as Element).closest('[data-bird]');
  tapBird.current=birdAt(e.clientX,e.clientY)[0]||null;
  if(target&&e.pointerType==='mouse')return;
  pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pointers.current.size>1){didDrag.current=true;tapBird.current=null;}
  e.currentTarget.setPointerCapture(e.pointerId);startGesture();
 }
 function move(e:React.PointerEvent<SVGSVGElement>){if(!pointers.current.has(e.pointerId)||!gesture.current)return;pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});const p=[...pointers.current.values()],g=gesture.current,center=p.length===2?{x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2}:p[0];const dx=center.x-g.center.x,dy=center.y-g.center.y;if(Math.abs(dx)+Math.abs(dy)>4){didDrag.current=true;setPlaying(false);}const distance=p.length===2?Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y):0,units=g.distance&&distance?Math.max(.00001,Math.min(3,g.camera.units*g.distance/distance)):g.camera.units;const rect=e.currentTarget.getBoundingClientRect();setCamera({x:g.camera.x+(g.center.x-rect.left-size.w/2)*g.camera.units-(center.x-rect.left-size.w/2)*units,y:Math.max(0,Math.min(1024,g.camera.y+(g.center.y-rect.top-size.h/2)*g.camera.units-(center.y-rect.top-size.h/2)*units)),units});}
 function up(e:React.PointerEvent<SVGSVGElement>){if(!pointers.current.has(e.pointerId))return;if(e.pointerType!=='mouse')suppressClick.current=true;if(e.type==='pointerup'&&e.pointerType!=='mouse'&&!didDrag.current&&tapBird.current&&pointers.current.size===1)selectAt(e.clientX,e.clientY);tapBird.current=null;pointers.current.delete(e.pointerId);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);if(pointers.current.size)startGesture();else gesture.current=null;}
 const box=[camera.x-size.w*camera.units/2,camera.y-size.h*camera.units/2,size.w*camera.units,size.h*camera.units].join(' ');
 const markerRadius=7*camera.units;
 function step(delta:number){if(!points.length)return;const times=[first,...points.map(p=>Date.parse(p[2])),last];seek(delta<0?[...times].reverse().find(t=>t<cursor)??first:times.find(t=>t>cursor)??last);}
 const timeline=<>
 {!group&&trail?.replay&&!replay&&<div className="migration-timeline replay-load" role="status" aria-live="polite" aria-busy={!replayStatus||replayStatus.startsWith('Loading')}>
 {(!replayStatus||replayStatus.startsWith('Loading'))&&<span className="replay-spinner" aria-hidden="true"/>}
 <span>{replayStatus||'Loading migration timeline…'}</span>
 {replayStatus.startsWith('Could not')&&<button onClick={onRetry}>Retry timeline</button>}
 </div>}
 {replay&&<div className="migration-timeline timeline-compact"><div className="playback-controls"><button className="primary" onClick={togglePlay} disabled={points.length<2} aria-label={playing?'Pause migration playback':'Play migration playback'}>{playing?'Ⅱ Pause':'▶ Play'}</button><label><span className="speed-label">Playback speed</span><select aria-label="Playback speed" value={speed} onChange={e=>setSpeed(Number(e.target.value))}><option value="1">1 day/sec</option><option value="7">1 week/sec</option><option value="30">30 days/sec</option><option value="90">90 days/sec</option></select></label><button type="button" className="follow-bird" aria-pressed={follow} disabled={!trail?.id||!selectedPoints.length} onClick={()=>setFollow(v=>!v)}>Follow bird</button><div className="replay-date-actions"><time className="playback-time" dateTime={new Date(cursor).toISOString()}>{date(cursor)}</time></div>{anyGap&&<span className="tracking-gap">Tracking gap — holding position</span>}</div><div className="timeline-dial"><button aria-label="Previous recorded position" disabled={cursor<=first||!points.length} onClick={()=>step(-1)}>‹</button><input type="range" aria-label="Migration timeline" aria-valuetext={'Timeline '+date(cursor)+(anyGap?'. Tracking gap.':'')} min={first} max={Math.max(first+1,last)} step="1" value={cursor} disabled={points.length<2} onChange={e=>seek(Number(e.target.value))} onPointerDown={()=>setPlaying(false)} onKeyDown={e=>{setPlaying(false);if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();step(e.key==='ArrowLeft'?-1:1);}}}/><button aria-label="Next recorded position" disabled={cursor>=last||!points.length} onClick={()=>step(1)}>›</button></div><div className="timeline-dates"><span>{new Date(first).toISOString().slice(0,10)}</span><span>{new Date(last).toISOString().slice(0,10)}</span></div></div>}
 </>;
 return <section className={'migration-map'+((group||trail?.replay)&&!externalTimeline?' has-replay':'')} aria-label="Interactive migration map">
 <div ref={host} className="map mercator-map"><svg ref={svg} viewBox={box} aria-label="Migration map. Drag to pan; use arrow keys to pan and plus or minus to zoom." tabIndex={0} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up} onKeyDown={e=>{if(e.target!==e.currentTarget)return;const shifts:any={ArrowLeft:[-60,0],ArrowRight:[60,0],ArrowUp:[0,-60],ArrowDown:[0,60]};if(shifts[e.key]){e.preventDefault();stopZoom();setPlaying(false);const [x,y]=shifts[e.key];setCamera(c=>({...c,x:c.x+x*c.units,y:c.y+y*c.units}));}else if(e.key==='+'||e.key==='='){e.preventDefault();zoom(.7);}else if(e.key==='-'){e.preventDefault();zoom(1.4);}}}>
 {baseMap}
 <text x={mercator([10.5,53.8])[0]} y={mercator([10.5,53.8])[1]} textAnchor="middle" fontSize={10*camera.units} fill="#202b4d" fontWeight="bold">GERMANY · FINISH</text>
 {!group&&trailStrokes}
 {group&&teamSegments.map((t,ti)=>{const end=Math.min(cursor,Date.parse(t.points.at(-1)?.[2]||'')),start=Date.parse(t.points[0]?.[2]||'');return <g key={t.bird.id}>{t.segments.map((seg:any)=>{
 const a=t.points[seg.index],b=t.points[seg.index+1],at=Date.parse(a[2]),bt=Date.parse(b[2]);if(at>=cursor)return null;
 const partial=bt>cursor?replayPosition(t.points,cursor):null,xy=partial?.xy||mercator(b),from=mercator(a),id=gradientPrefix+'-'+ti+'-'+seg.index;
 return <g key={seg.index}><defs><linearGradient id={id} gradientUnits="userSpaceOnUse" x1={from[0]} y1={from[1]} x2={xy[0]} y2={xy[1]}><stop offset="0" stopColor={color(t.bird)} stopOpacity={trailOpacity(at,start,end)}/><stop offset="1" stopColor={color(t.bird)} stopOpacity={trailOpacity(Math.min(bt,cursor),start,end)}/></linearGradient></defs><path d={`M${from.join(',')} L${xy.join(',')}`} fill="none" stroke={'url(#'+id+')'} strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke"/></g>;
 })}</g>;})}
 {!group&&replay&&position?.canInterpolate&&<>
 <path d={`M${position.xy.join(',')} L${mercator(points[index+1]).join(',')}`} fill="none" stroke="#73819c" strokeOpacity=".7" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>
 {position.estimated&&<path d={`M${mercator(point).join(',')} L${position.xy.join(',')}`} fill="none" stroke="#a77c16" strokeOpacity=".7" strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>}
 </>}
 {displayedBirds.map(b=>{const [x,y]=mercator([b.longitude,b.latitude]);return <g data-bird={b.id} key={b.id} role="button" tabIndex={0} aria-label={'View '+birdName(b.name)} onClick={e=>{if(!didDrag.current&&!suppressClick.current){if(e.detail===0)chooseMarker(b);else selectAt(e.clientX,e.clientY);}}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();chooseMarker(b);}}}><title>{birdName(b.name)}</title><circle className="bird-hit-target" cx={x} cy={y} r={22*camera.units} fill="transparent"/>{b.id===trail?.id?<SelectedMarker bird={b} x={x} y={y} units={camera.units}/>:(<circle cx={x} cy={y} r={markerRadius} fill={color(b)} stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke"/>)}</g>;})}
 {!group&&replay&&point&&<g aria-label={birdName(trail.name)+(position?.estimated?' estimated location: ':' recorded location: ')+date(position?.estimated?time:point[2])}><SelectedMarker bird={trail} x={position!.xy[0]} y={position!.xy[1]} units={camera.units}/><title>{birdName(trail.name)} · {position?.estimated?'Estimated position · ':''}{date(position?.estimated?time:point[2])}</title></g>}
 </svg><div className="maptools"><button aria-label="Zoom in" onClick={()=>zoom(.7)}>+</button><button aria-label="Zoom out" onClick={()=>zoom(1.4)}>−</button><button onClick={reset}>{replay?'Fit route':'Reset view'}</button></div>
 </div>
 {group&&(leagueLoading||leagueFailed||!points.length)&&<div className="league-trail-status" role="status">{leagueLoading?'Loading team trails…':leagueFailed?'Some trails could not load.':'No observations in this window.'}{leagueFailed&&<button onClick={onRetry}>Retry trails</button>}</div>}
 {externalTimeline?(timelineTarget?createPortal(timeline,timelineTarget):null):timeline}
 </section>;
}
