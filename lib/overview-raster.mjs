import {displaySegments} from './prepared-trail.mjs';
import {replayPosition} from './map-geometry.mjs';
import {trailOpacity} from './league-trails.mjs';

export function drawTrackTrails(ctx,camera,size,tracks,cursor,color){
 const left=camera.x-size.w*camera.units/2,top=camera.y-size.h*camera.units/2;
 const pixel=xy=>[(xy[0]-left)/camera.units,(xy[1]-top)/camera.units];
 ctx.lineCap='round';ctx.lineWidth=3;ctx.globalAlpha=1;
 for(const t of tracks){
  const hex=color(t.bird),rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(',');
  const end=Math.min(cursor,Date.parse(t.points.at(-1)?.[2]||'')),start=Date.parse(t.points[0]?.[2]||'');
  for(const seg of displaySegments(t,camera.units)){
   const at=seg.at??Date.parse(t.points[seg.index][2]),bt=seg.bt??Date.parse(t.points[seg.index+1][2]);if(at>=cursor)break;
   const from=pixel(seg.from),to=pixel(bt>cursor?replayPosition(t.points,cursor).xy:seg.to);
   if((from[0]<-3&&to[0]<-3)||(from[1]<-3&&to[1]<-3)||(from[0]>size.w+3&&to[0]>size.w+3)||(from[1]>size.h+3&&to[1]>size.h+3))continue;
   const gradient=ctx.createLinearGradient(...from,...to);
   gradient.addColorStop(0,`rgba(${rgb},${trailOpacity(at,start,end)})`);
   gradient.addColorStop(1,`rgba(${rgb},${trailOpacity(Math.min(bt,cursor),start,end)})`);
   ctx.strokeStyle=gradient;ctx.beginPath();ctx.moveTo(...from);ctx.lineTo(...to);ctx.stroke();
  }
 }
}

// One bounded, padded bitmap for the stationary overview. Replay stays exact.
// Retained mode lets the browser composite the padded layer without copying
// its pixels each frame. Position and scale share the marker camera transform.
export function createOverviewRaster(makeCanvas,{retained=false}={}){
 let cache=null;
 return {draw(canvas,camera,size,tracks,color,ratio,settled=false){
  const left=camera.x-size.w*camera.units/2,top=camera.y-size.h*camera.units/2;
  const colors=tracks.map(t=>color(t.bird));
  const same=cache&&cache.tracks===tracks&&cache.colors.every((c,i)=>c===colors[i])&&cache.ratio===ratio&&cache.viewW===size.w&&cache.viewH===size.h;
  const zoom=cache?cache.units/camera.units:0;
  const covered=same&&zoom>=.8&&zoom<=1.25&&left>=cache.left&&top>=cache.top&&left+size.w*camera.units<=cache.right&&top+size.h*camera.units<=cache.bottom;
  const exact=same&&cache.x===camera.x&&cache.y===camera.y&&cache.units===camera.units;
  let rebuilt=false;
  if(!covered||(settled&&!exact)){
   const pad=128,w=size.w+pad*2,h=size.h+pad*2,tile=cache?.tile||makeCanvas();
   tile.width=Math.ceil(w*ratio);tile.height=Math.ceil(h*ratio);
   const ctx=tile.getContext('2d');ctx.setTransform(tile.width/w,0,0,tile.height/h,0,0);
   drawTrackTrails(ctx,camera,{w,h},tracks,Infinity,color);
   cache={tile,tracks,colors,ratio,viewW:size.w,viewH:size.h,x:camera.x,y:camera.y,units:camera.units,left:left-pad*camera.units,top:top-pad*camera.units,right:left+(size.w+pad)*camera.units,bottom:top+(size.h+pad)*camera.units,w,h};rebuilt=true;
  }
  const scale=cache.units/camera.units,offsetX=(cache.left-left)/camera.units,offsetY=(cache.top-top)/camera.units;
  if(retained)return {rebuilt,width:cache.w,height:cache.h,scale,offsetX,offsetY};
  const ctx=canvas.getContext('2d');ctx.setTransform(canvas.width/size.w,0,0,canvas.height/size.h,0,0);ctx.globalAlpha=1;ctx.clearRect(0,0,size.w,size.h);
  ctx.drawImage(cache.tile,offsetX,offsetY,cache.w*scale,cache.h*scale);
  return {rebuilt};
 }};
}
