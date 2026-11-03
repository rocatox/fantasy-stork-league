import {useLayoutEffect,useRef} from 'react';
import {mercator,replayPosition} from '../lib/map-geometry.mjs';
import {trailOpacity} from '../lib/league-trails.mjs';
// Canvas keeps thousands of independent, translucent legs out of the DOM.
// Coordinates and gap decisions still come from the same screened map geometry.
export default function TrailCanvas({camera,size,segments,points,index,replay,position,tracks,cursor,color}:any){
 const ref=useRef<HTMLCanvasElement>(null);
 const left=camera.x-size.w*camera.units/2,top=camera.y-size.h*camera.units/2;
 useLayoutEffect(()=>{
  const canvas=ref.current;if(!canvas)return;const ctx=canvas.getContext('2d');if(!ctx)return;
  const ratio=Math.min(window.devicePixelRatio||1,2);
  if(canvas.width!==Math.round(size.w*ratio)||canvas.height!==Math.round(size.h*ratio)){canvas.width=Math.round(size.w*ratio);canvas.height=Math.round(size.h*ratio);}
  ctx.setTransform(canvas.width/size.w,0,0,canvas.height/size.h,0,0);ctx.clearRect(0,0,size.w,size.h);ctx.lineCap='round';
  const pixel=(xy:number[])=>[(xy[0]-left)/camera.units,(xy[1]-top)/camera.units];
  function line(a:number[],b:number[],stroke:string|CanvasGradient,width:number,alpha=1){
   if((a[0]<-width&&b[0]<-width)||(a[1]<-width&&b[1]<-width)||(a[0]>size.w+width&&b[0]>size.w+width)||(a[1]>size.h+width&&b[1]>size.h+width))return;
   ctx!.strokeStyle=stroke;ctx!.globalAlpha=alpha;ctx!.lineWidth=width;ctx!.beginPath();ctx!.moveTo(a[0],a[1]);ctx!.lineTo(b[0],b[1]);ctx!.stroke();
  }
  for(const seg of segments){if(replay&&seg.index===index)continue;const past=replay&&seg.index<index;line(pixel(seg.from),pixel(seg.to),replay?(past?'#a77c16':'#73819c'):'#c29a34',past?3:2,.7);}
  for(const t of tracks){
   const end=Math.min(cursor,Date.parse(t.points.at(-1)?.[2]||'')),start=Date.parse(t.points[0]?.[2]||'');
   for(const seg of t.segments){const a=t.points[seg.index],b=t.points[seg.index+1],at=Date.parse(a[2]),bt=Date.parse(b[2]);if(at>=cursor)continue;
    const from=pixel(seg.from),to=pixel(bt>cursor?replayPosition(t.points,cursor).xy:seg.to);
    // A transparent-to-solid gradient per leg preserves overlaps and continuous fading.
    const gradient=ctx.createLinearGradient(from[0],from[1],to[0],to[1]);
    const hex=color(t.bird),rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(',');
    gradient.addColorStop(0,`rgba(${rgb},${trailOpacity(at,start,end)})`);gradient.addColorStop(1,`rgba(${rgb},${trailOpacity(Math.min(bt,cursor),start,end)})`);
    line(from,to,gradient,3);
   }
  }
  if(replay&&position?.canInterpolate){line(pixel(position.xy),pixel(mercator(points[index+1])),'#73819c',2,.7);if(position.estimated)line(pixel(mercator(points[index])),pixel(position.xy),'#a77c16',3,.7);}
 },[camera,size,segments,points,index,replay,position,tracks,cursor,color,left,top]);
 return <canvas ref={ref} className="map-trail-canvas" aria-hidden="true"/>;
}
