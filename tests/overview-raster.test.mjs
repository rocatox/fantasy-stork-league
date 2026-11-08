import test from 'node:test';
import assert from 'node:assert/strict';
import {createOverviewRaster} from '../lib/overview-raster.mjs';
import {mercator} from '../lib/map-geometry.mjs';
function surface(){const calls=[];const ctx={setTransform(){},clearRect(){},drawImage(...args){calls.push(args)},createLinearGradient(){return {addColorStop(){}}},beginPath(){},moveTo(){},lineTo(){},stroke(){}};return {width:800,height:600,getContext:()=>ctx,calls};}
test('overview reuses bitmap through small pans and zooms; settles at exact camera',()=>{
 const target=surface(),cache=createOverviewRaster(surface),tracks=[],color=()=> '#c29a34',size={w:800,h:600},camera={x:0,y:0,units:1};
 assert.equal(cache.draw(target,camera,size,tracks,color,1).rebuilt,true);
 assert.equal(cache.draw(target,{...camera,x:20},size,tracks,color,1).rebuilt,false);
 const [,x,y,w,h]=target.calls.at(-1);assert.deepEqual([x,y,w,h],[-148,-128,1056,856]);
 assert.equal(cache.draw(target,{...camera,units:.9},size,tracks,color,1).rebuilt,false);
 assert.equal(cache.draw(target,{...camera,units:.9},size,tracks,color,1,true).rebuilt,true);
 assert.equal(cache.draw(target,{...camera,units:.9},size,tracks,color,1,true).rebuilt,false);
});
test('cached trail endpoint matches marker projection through fractional pans, zooms and settling',()=>{
 const point=[8,48,'2026-11-01T00:00:00Z'],xy=mercator(point),from=[xy[0]-.1,xy[1]-.1];
 const tracks=[{bird:{},points:[[7.9,47.9,'2026-10-31T00:00:00Z'],point],segments:[{from,to:xy,index:0,at:Date.parse('2026-10-31'),bt:Date.parse('2026-11-01')}]}];
 for(const retained of [false,true])for(const ratio of [1,1.25,1.5,2])for(const size of [{w:806.875,h:610},{w:335.5,h:440}]){
  const target=surface();let tile;
  const cache=createOverviewRaster(()=>{tile=surface();const ctx=tile.getContext();ctx.setTransform=(sx,_b,_c,sy)=>{tile.sx=sx;tile.sy=sy;};ctx.lineTo=(x,y)=>{tile.endpoint=[x*tile.sx,y*tile.sy];};return tile;},{retained});
  const base={x:xy[0],y:xy[1],units:.02},color=()=> '#c29a34';
  for(let i=0;i<60;i++){
   const camera={x:base.x+Math.sin(i*.4)*.9,y:base.y+Math.cos(i*.3)*.5,units:base.units*Math.pow(.97,i%20)};
   for(const settled of [false,true]){
    const result=cache.draw(target,camera,size,tracks,color,ratio,settled);
    const [image,x,y,w,h]=retained?[tile,result.offsetX,result.offsetY,result.width*result.scale,result.height*result.scale]:target.calls.at(-1);
    if(retained)assert.equal(target.calls.length,0,'retained layer must not copy its pixels each frame');
    const actual=[x+image.endpoint[0]/image.width*w,y+image.endpoint[1]/image.height*h];
    const marker=[(xy[0]-camera.x)/camera.units+size.w/2,(xy[1]-camera.y)/camera.units+size.h/2];
    assert.ok(Math.abs(actual[0]-marker[0])<1e-8&&Math.abs(actual[1]-marker[1])<1e-8,`projection drift at ratio ${ratio}, frame ${i}`);
   }
  }
 }
});
test('overview invalidates for uncovered area, zoom, data, color, size and pixel density',()=>{
 const target=surface(),cache=createOverviewRaster(surface),tracks=[{bird:{},points:[],segments:[]}],size={w:800,h:600};let shade='#c29a34';const color=()=>shade,camera={x:0,y:0,units:1};
 cache.draw(target,camera,size,tracks,color,1);
 assert.equal(cache.draw(target,{...camera,x:200},size,tracks,color,1).rebuilt,true);
 assert.equal(cache.draw(target,{...camera,units:.4},size,tracks,color,1).rebuilt,true);
 assert.equal(cache.draw(target,camera,size,[...tracks],color,1).rebuilt,true);
 cache.draw(target,camera,size,tracks,color,1);shade='#202b4d';assert.equal(cache.draw(target,camera,size,tracks,color,1).rebuilt,true);
 assert.equal(cache.draw(target,camera,{w:390,h:440},tracks,color,1).rebuilt,true);
 assert.equal(cache.draw(target,camera,{w:390,h:440},tracks,color,2).rebuilt,true);
});

test('retained visible canvas remains aligned across continuous movement and cache rebuilds',()=>{
 const xy=mercator([8,48]),tracks=[{bird:{},points:[[7,47,'2026-10-31'],[8,48,'2026-11-01']],segments:[{from:[xy[0]-.1,xy[1]-.1],to:xy,index:0}]}];
 for(const ratio of [1,1.25,1.5,2]){
  const canvas=surface(),ctx=canvas.getContext();let endpoint,sx,sy;
  ctx.setTransform=(x,_b,_c,y)=>{sx=x;sy=y;};
  ctx.lineTo=(x,y)=>{endpoint=[x*sx,y*sy];};
  const cache=createOverviewRaster(()=>canvas,{retained:true}),size={w:806.875,h:610},color=()=> '#c29a34';
  let rebuilds=0,reuses=0;
  for(let i=0;i<240;i++){
   const camera={x:xy[0]+Math.sin(i*.03)*3,y:xy[1]+Math.cos(i*.02)*2,units:.02*Math.exp(Math.sin(i*.025)*.5)};
   const result=cache.draw(canvas,camera,size,tracks,color,ratio,i===239);
   result.rebuilt?rebuilds++:reuses++;
   const actual=[result.offsetX+endpoint[0]/canvas.width*result.width*result.scale,result.offsetY+endpoint[1]/canvas.height*result.height*result.scale];
   const expected=[(xy[0]-camera.x)/camera.units+size.w/2,(xy[1]-camera.y)/camera.units+size.h/2];
   assert.ok(actual.every((n,j)=>Math.abs(n-expected[j])<1e-8),`drift on continuous frame ${i}, DPR ${ratio}`);
  }
  assert.ok(rebuilds>1&&reuses>100,'exercise reuse and boundary/zoom rebuilds');
  assert.equal(canvas.calls.length,0,'no per-frame bitmap copying');
 }
});
