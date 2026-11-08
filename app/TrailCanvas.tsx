import {useLayoutEffect,useRef} from 'react';
import {mercator,replayPosition} from '../lib/map-geometry.mjs';
import {displaySegments} from '../lib/prepared-trail.mjs';
import {drawTrackTrails,createOverviewRaster} from '../lib/overview-raster.mjs';
// Canvas keeps thousands of independent, translucent legs out of the DOM.
// Coordinates and gap decisions still come from the same screened map geometry.
export default function TrailCanvas({camera,size,segments,prepared,points,index,replay,position,tracks,cursor,color}:any){
 const ref=useRef<HTMLCanvasElement>(null),overview=useRef<any>(null);
 const left=camera.x-size.w*camera.units/2,top=camera.y-size.h*camera.units/2;
 useLayoutEffect(()=>{
  const canvas=ref.current;if(!canvas)return;const ctx=canvas.getContext('2d');if(!ctx)return;
  const ratio=Math.min(window.devicePixelRatio||1,2);
  if(canvas.width!==Math.round(size.w*ratio)||canvas.height!==Math.round(size.h*ratio)){canvas.width=Math.round(size.w*ratio);canvas.height=Math.round(size.h*ratio);}
  if(!replay&&!prepared&&!segments.length&&cursor===Infinity&&tracks.length){
   overview.current??=createOverviewRaster(()=>document.createElement('canvas'));
   overview.current.draw(canvas,camera,size,tracks,color,ratio);
   const settle=window.setTimeout(()=>overview.current?.draw(canvas,camera,size,tracks,color,ratio,true),160);
   return()=>window.clearTimeout(settle);
  }
  overview.current=null;
  ctx.setTransform(canvas.width/size.w,0,0,canvas.height/size.h,0,0);ctx.clearRect(0,0,size.w,size.h);ctx.lineCap='round';
  const pixel=(xy:number[])=>[(xy[0]-left)/camera.units,(xy[1]-top)/camera.units];
  function line(a:number[],b:number[],stroke:string|CanvasGradient,width:number,alpha=1){
   if((a[0]<-width&&b[0]<-width)||(a[1]<-width&&b[1]<-width)||(a[0]>size.w+width&&b[0]>size.w+width)||(a[1]>size.h+width&&b[1]>size.h+width))return;
   ctx!.strokeStyle=stroke;ctx!.globalAlpha=alpha;ctx!.lineWidth=width;ctx!.beginPath();ctx!.moveTo(a[0],a[1]);ctx!.lineTo(b[0],b[1]);ctx!.stroke();
  }
  for(const seg of prepared?displaySegments(prepared,camera.units):segments){
   const endIndex=seg.endIndex??seg.index+1;
   // Split simplified legs at the exact replay position, without connecting gaps.
   if(replay&&seg.index<=index&&endIndex>index){
    const here=position?.canInterpolate?position.xy:mercator(points[index]);
    if(seg.index<index||position?.estimated)line(pixel(seg.from),pixel(here),'#a77c16',3,.7);
    line(pixel(here),pixel(seg.to),'#73819c',2,.7);continue;
   }
   const past=replay&&endIndex<=index;line(pixel(seg.from),pixel(seg.to),replay?(past?'#a77c16':'#73819c'):'#c29a34',past?3:2,.7);
  }
  drawTrackTrails(ctx,camera,size,tracks,cursor,color);

 },[camera,size,segments,prepared,points,index,replay,position,tracks,cursor,color,left,top]);
 return <canvas ref={ref} className="map-trail-canvas" aria-hidden="true"/>;
}
