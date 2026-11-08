import test from 'node:test';
import assert from 'node:assert/strict';
import {createOverviewRaster} from '../lib/overview-raster.mjs';
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
