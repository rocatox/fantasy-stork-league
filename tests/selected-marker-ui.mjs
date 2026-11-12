import assert from 'node:assert/strict';
import fs from 'node:fs';
import {build} from 'esbuild';

export async function checkSelectedMarker({page,out}){
 await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{SelectedMarker}from'./app/MigrationMap';const root=createRoot(document.getElementById('root'));window.drawMarker=(units,id=1)=>root.render(<svg width="120" height="120" viewBox="0 0 120 120"><SelectedMarker bird={{portraitId:id}} x={(512-512)/units+60} y={(400-400)/units+60}/></svg>);window.drawMarker(.1);`,resolveDir:process.cwd(),loader:'tsx'},outfile:out+'/marker-test.js',bundle:true,format:'esm',jsx:'automatic'});
 fs.writeFileSync(out+'/marker-test.html','<!doctype html><html><body style="margin:0;background:#fff"><div id="root"></div><script type="module" src="/marker-test.js"></script></body></html>');
 await page.goto('http://127.0.0.1:4197/marker-test.html');
 const svg=page.locator('svg');
 async function capture(units,id){await page.evaluate(({units,id})=>window.drawMarker(units,id),{units,id});await page.waitForTimeout(120);await page.evaluate(async()=>{const image=new Image();image.src=document.querySelector('svg image').getAttribute('href');await image.decode();});return(await svg.screenshot()).toString('base64');}
 for(const id of [1,32,64]){
  const baseline=await capture(.1,id);
  for(const units of [.001,.0001,.00001]){
   const current=await capture(units,id);
   const error=await page.evaluate(async({baseline,current})=>{async function pixels(src){const img=new Image();img.src='data:image/png;base64,'+src;await img.decode();const c=document.createElement('canvas');c.width=120;c.height=120;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return ctx.getImageData(44,44,32,32).data;}const a=await pixels(baseline),b=await pixels(current);let diff=0;for(let i=0;i<a.length;i++)if(i%4!==3)diff+=Math.abs(a[i]-b[i]);return diff/(32*32*3);},{baseline,current});
   assert.ok(error<6,`Portrait ${id}, units ${units}: zoom altered portrait pixels (mean error ${error.toFixed(2)})`);
  }
 }
 console.log('Selected portraits retain image detail through maximum map zoom.');
 for(const view of ['map','leagues']){
  await page.goto('http://127.0.0.1:4197/?view='+view+(view==='leagues'?'&league=audit-league':''));
  const map=page.locator('.map-interaction-layer');await map.waitFor();
  if(view==='map')await page.locator('.birdrow').first().click();
  else await map.locator('[data-bird]').first().dispatchEvent('click');
  const portrait=map.locator('.selected-portrait-marker image').first();await portrait.waitFor();
  const before=await portrait.evaluate(e=>e.getBoundingClientRect().width);
  for(let i=0;i<40;i++){await page.getByRole('button',{name:'Zoom in',exact:true}).evaluate(e=>e.click());await page.waitForTimeout(16);}
  const units=Number((await map.getAttribute('data-camera')).split(' ')[2]);assert.equal(units,.00001);
  const after=await portrait.evaluate(e=>e.getBoundingClientRect().width);
  assert.ok(Math.abs(before-after)<.1,view+': portrait must retain its screen size at maximum zoom');
 }
}
