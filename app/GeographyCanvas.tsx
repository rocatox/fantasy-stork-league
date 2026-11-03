import {useLayoutEffect,useRef} from 'react';
import countries from '../data/map.json';
import {mercator} from '../lib/map-geometry.mjs';
// Retained canvas paths avoid SVG polygon layout and non-scaling-stroke work
// on every camera frame. This is display geometry only, never race boundaries.
let shapes:any[]|null=null;
function geography(){
 if(shapes)return shapes;
 shapes=countries.flatMap((country:any)=>country.rings.map((ring:number[][])=>{
  const path=new Path2D();let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  ring.forEach((p,i)=>{const [x,y]=mercator([p[0],p[1]]);if(i)path.lineTo(x,y);else path.moveTo(x,y);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);});path.closePath();
  return {path,minX,maxX,minY,maxY,germany:country.code==='DE'};
 }));return shapes;
}
export default function GeographyCanvas({camera,size}:any){
 const ref=useRef<HTMLCanvasElement>(null);
 useLayoutEffect(()=>{
  const canvas=ref.current,ctx=canvas?.getContext('2d');if(!canvas||!ctx)return;
  const ratio=Math.min(devicePixelRatio||1,2),width=Math.round(size.w*ratio),height=Math.round(size.h*ratio);
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
  const left=camera.x-size.w*camera.units/2,top=camera.y-size.h*camera.units/2,right=left+size.w*camera.units,bottom=top+size.h*camera.units;
  ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,width,height);
  const sx=width/size.w/camera.units,sy=height/size.h/camera.units;
  ctx.setTransform(sx,0,0,sy,-left*sx,-top*sy);ctx.lineWidth=.7*camera.units;ctx.strokeStyle='#b9c3d5';
  for(const shape of geography()){
   if(shape.maxX<left||shape.minX>right||shape.maxY<top||shape.minY>bottom)continue;
   ctx.fillStyle='#faf9f4';ctx.fill(shape.path);
   if(shape.germany){ctx.fillStyle='rgba(194,154,52,.16)';ctx.fill(shape.path);}else ctx.stroke(shape.path);
  }
 },[camera,size]);
 return <canvas ref={ref} className="map-geography-layer" aria-hidden="true"/>;
}
