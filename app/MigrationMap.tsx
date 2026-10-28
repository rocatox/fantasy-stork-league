import {useEffect,useMemo,useRef,useState} from 'react';
import countries from '../data/map.json';
import {mercator,fitCamera,trackPoints,observationIndex,trailSegments,replayPosition} from '../lib/map-geometry.mjs';
import './MigrationMap.css';
const geography=countries.map((c:any)=>({...c,paths:c.rings.map((r:any)=>r.map((p:any)=>mercator(p).join(',')).join(' '))}));
const baseMap=(geography.map((c:any,i:number)=><g key={i}>{c.paths.map((p:string,j:number)=><g key={j}><polygon points={p} fill="#faf9f4" stroke={c.code==='DE'?'none':'#b9c3d5'} strokeWidth=".7" vectorEffect="non-scaling-stroke"/>{c.code==='DE'&&<polygon points={p} fill="#c29a34" fillOpacity=".16" stroke="none" vectorEffect="non-scaling-stroke"/>}</g>)}</g>));
const overview=[[-25,-35],[60,72]];
const date=(s:string|number)=>new Date(s).toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'UTC'})+' UTC';
export default function MigrationMap({birds,trail,color,onBird,onClose,league=false}:{birds:any[],trail:any,color:(b:any)=>string,onBird:(b:any)=>void,onClose:()=>void,league?:boolean}){
 const host=useRef<HTMLDivElement>(null),svg=useRef<SVGSVGElement>(null),pointers=useRef(new Map<number,{x:number,y:number}>()),gesture=useRef<any>(null),didDrag=useRef(false),tapBird=useRef<any>(null);
 const [size,setSize]=useState({w:800,h:610}),[camera,setCamera]=useState(()=>fitCamera(overview,800,610)),[time,setTime]=useState(0),[playing,setPlaying]=useState(false),[speed,setSpeed]=useState(7);
 const points=useMemo(()=>trackPoints(trail?.history||[]),[trail?.history]);
 const replay=!!trail?.replay&&points.length>0,index=observationIndex(points,time),point=points[index];
 const position=replayPosition(points,time);
 const first=points.length?Date.parse(points[0][2]):0,last=points.length?Date.parse(points.at(-1)[2]):0;
 const segments=useMemo(()=>trailSegments(points),[points]);
 // Separate strokes composite independently, making repeat visits and crossings darker.
 const trailStrokes=useMemo(()=>segments.filter(s=>!replay||s.index!==index).map(s=><path key={s.index} d={s.path} fill="none" stroke={replay?(s.index<index?'#a77c16':'#73819c'):'#c29a34'} strokeOpacity=".7" strokeWidth={replay&&s.index<index?3:2} strokeLinecap="round" vectorEffect="non-scaling-stroke"/>),[segments,replay,index]);
 useEffect(()=>{const el=host.current;if(!el)return;const observer=new ResizeObserver(([entry])=>setSize({w:entry.contentRect.width,h:entry.contentRect.height}));observer.observe(el);return()=>observer.disconnect();},[]);
 // Fit once on a newly chosen track; scrubbing never moves the user's camera.
 const trackKey=trail?.id+':'+Boolean(trail?.replay);
 useEffect(()=>{setTime(last);setPlaying(false);},[trackKey,last]);
 useEffect(()=>{
  if(!playing||!replay||first===last)return;
  let cursor=time,previous=performance.now(),frame=0;
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
 function togglePlay(){if(playing){setPlaying(false);return;}if(time>=last)setTime(first);setPlaying(true);}
 useEffect(()=>{setCamera(fitCamera(points.length?points:overview,size.w,size.h));},[trackKey,last,size.w,size.h]);
 function reset(){setPlaying(false);setCamera(fitCamera(points.length?points:overview,size.w,size.h));}
 function zoom(factor:number){setCamera(c=>({...c,units:Math.max(.008,Math.min(3,c.units*factor))}));}
 function startGesture(){const p=[...pointers.current.values()];gesture.current={camera,center:p.length===2?{x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2}:p[0],distance:p.length===2?Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y):0};}
 function down(e:React.PointerEvent<SVGSVGElement>){if(e.button!==0)return;didDrag.current=false;const target=(e.target as Element).closest('[data-bird]');tapBird.current=target?birds.find(b=>b.id===target.getAttribute('data-bird')):null;if(target&&e.pointerType==='mouse')return;pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});e.currentTarget.setPointerCapture(e.pointerId);didDrag.current=false;startGesture();}
 function move(e:React.PointerEvent<SVGSVGElement>){if(!pointers.current.has(e.pointerId)||!gesture.current)return;pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});const p=[...pointers.current.values()],g=gesture.current,center=p.length===2?{x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2}:p[0];const dx=center.x-g.center.x,dy=center.y-g.center.y;if(Math.abs(dx)+Math.abs(dy)>4){didDrag.current=true;setPlaying(false);}const distance=p.length===2?Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y):0,units=g.distance&&distance?Math.max(.008,Math.min(3,g.camera.units*g.distance/distance)):g.camera.units;const rect=e.currentTarget.getBoundingClientRect();setCamera({x:g.camera.x+(g.center.x-rect.left-size.w/2)*g.camera.units-(center.x-rect.left-size.w/2)*units,y:Math.max(0,Math.min(1024,g.camera.y+(g.center.y-rect.top-size.h/2)*g.camera.units-(center.y-rect.top-size.h/2)*units)),units});}
 function up(e:React.PointerEvent<SVGSVGElement>){if(e.type==='pointerup'&&e.pointerType!=='mouse'&&!didDrag.current&&tapBird.current&&pointers.current.size===1)onBird(tapBird.current);tapBird.current=null;pointers.current.delete(e.pointerId);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);if(pointers.current.size)startGesture();else gesture.current=null;}
 const box=[camera.x-size.w*camera.units/2,camera.y-size.h*camera.units/2,size.w*camera.units,size.h*camera.units].join(' ');
 const markerRadius=7*camera.units;
 function step(delta:number){seek(Date.parse(points[Math.max(0,Math.min(points.length-1,index+delta))][2]));}
 return <section className={'migration-map'+(replay?' has-replay':'')} aria-label="Interactive migration map">
 <div ref={host} className="map mercator-map"><svg ref={svg} viewBox={box} aria-label="Migration map. Drag to pan; use arrow keys to pan and plus or minus to zoom." tabIndex={0} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={e=>{if(e.target!==e.currentTarget)return;const shifts:any={ArrowLeft:[-60,0],ArrowRight:[60,0],ArrowUp:[0,-60],ArrowDown:[0,60]};if(shifts[e.key]){e.preventDefault();setPlaying(false);const [x,y]=shifts[e.key];setCamera(c=>({...c,x:c.x+x*c.units,y:c.y+y*c.units}));}else if(e.key==='+'||e.key==='='){e.preventDefault();zoom(.7);}else if(e.key==='-'){e.preventDefault();zoom(1.4);}}}>
 {baseMap}
 <text x={mercator([10.5,53.8])[0]} y={mercator([10.5,53.8])[1]} textAnchor="middle" fontSize={10*camera.units} fill="#202b4d" fontWeight="bold">GERMANY · FINISH</text>
 {trailStrokes}
 {replay&&position?.canInterpolate&&<>
 <path d={`M${position.xy.join(',')} L${mercator(points[index+1]).join(',')}`} fill="none" stroke="#73819c" strokeOpacity=".7" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>
 {position.estimated&&<path d={`M${mercator(point).join(',')} L${position.xy.join(',')}`} fill="none" stroke="#a77c16" strokeOpacity=".7" strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>}
 </>}
 {birds.filter(b=>!replay||b.id!==trail.id).map(b=>{const [x,y]=mercator([b.longitude,b.latitude]);return <g data-bird={b.id} key={b.id} role="button" tabIndex={0} aria-label={'View '+b.name} onClick={()=>{if(!didDrag.current)onBird(b);}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onBird(b);}}}><title>{b.name}</title><circle cx={x} cy={y} r={markerRadius} fill={color(b)} stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke"/></g>;})}
 {replay&&point&&<g aria-label={trail.name+(position?.estimated?' estimated location: ':' recorded location: ')+date(position?.estimated?time:point[2])}><circle cx={position!.xy[0]} cy={position!.xy[1]} r={13*camera.units} fill="#c29a34" fillOpacity=".25"/><circle cx={position!.xy[0]} cy={position!.xy[1]} r={8*camera.units} fill="#202b4d" stroke="#c29a34" strokeWidth="3" vectorEffect="non-scaling-stroke"/><title>{trail.name} · {position?.estimated?'Estimated position · ':''}{date(position?.estimated?time:point[2])}</title></g>}
 </svg><div className="maptools"><button aria-label="Zoom in" onClick={()=>zoom(.7)}>+</button><button aria-label="Zoom out" onClick={()=>zoom(1.4)}>−</button><button onClick={reset}>{replay?'Fit route':'Reset view'}</button>{replay&&<button onClick={()=>{const [x,y]=position!.xy;setCamera(c=>({...c,x,y}));}}>Find stork</button>}</div>
 <div className="mapkey">{replay?'● Navy / gold: historical stork · other birds: latest positions':league?'● Team locations':'● Gold: eligible · grey: not draftable'}<br/>Drag to pan · pinch or use + / − to zoom</div><small className="mapcredit">Mercator · Natural Earth overview · race scoring uses detailed BKG boundaries</small></div>
 {replay&&<div className="migration-timeline"><div className="timeline-heading"><div><span className="eyebrow">MIGRATION REPLAY</span><h3>{trail.name.split(' / ')[0].split(' (')[0]}</h3></div><button onClick={onClose}>Exit replay ×</button></div><div className="playback-controls"><button className="primary" onClick={togglePlay} disabled={points.length<2} aria-label={playing?'Pause migration playback':'Play migration playback'}>{playing?'Ⅱ Pause':time>=last?'▶ Play from start':'▶ Play'}</button><label>Playback speed<select aria-label="Playback speed" value={speed} onChange={e=>setSpeed(Number(e.target.value))}><option value="1">1 day / second</option><option value="7">1 week / second</option><option value="30">30 days / second</option><option value="90">90 days / second</option></select></label><time className="playback-time" dateTime={new Date(time||last).toISOString()}>{date(time||last)}</time>{position?.gap&&<span className="tracking-gap">Tracking gap — holding position</span>}</div><div className="timeline-dial"><button aria-label="Previous recorded position" disabled={index<=0} onClick={()=>step(-1)}>‹</button><input type="range" aria-label="Migration timeline" aria-valuetext={'Timeline '+date(time||last)+(position?.gap?'. Tracking gap.':'')} min={first} max={Math.max(first+1,last)} step="1" value={time||last} disabled={points.length<2} onChange={e=>seek(Number(e.target.value))} onPointerDown={()=>setPlaying(false)} onKeyDown={e=>{setPlaying(false);if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();step(e.key==='ArrowLeft'?-1:1);}}}/><button aria-label="Next recorded position" disabled={index>=points.length-1} onClick={()=>step(1)}>›</button></div><div className="timeline-dates"><span>{new Date(first).toISOString().slice(0,10)}</span><span>{new Date(last).toISOString().slice(0,10)}</span></div></div>}
 </section>;
}
