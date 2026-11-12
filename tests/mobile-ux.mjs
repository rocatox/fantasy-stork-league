import assert from 'node:assert/strict';
import fs from 'node:fs';
export async function auditMobile({page,context,league,birds,now,scan,results}){
 const findings=[];
 async function inspect(label){await scan(label);findings.push({label,...await page.evaluate(()=>({smallTargets:[...document.querySelectorAll('button,summary')].filter(e=>e.getClientRects().length&&e.getBoundingClientRect().height<32).map(e=>({text:(e.getAttribute('aria-label')||e.textContent).slice(0,65),height:Math.round(e.getBoundingClientRect().height)})).slice(0,20),smallInputs:[...document.querySelectorAll('input:not([type=checkbox]):not([type=range]),textarea,select')].filter(e=>e.getClientRects().length&&parseFloat(getComputedStyle(e).fontSize)<16).map(e=>({label:e.getAttribute('aria-label')||e.placeholder||e.tagName,size:getComputedStyle(e).fontSize})).slice(0,20)}))});fs.writeFileSync('.runner/mobile-ux-findings.json',JSON.stringify(findings,null,2));await page.screenshot({path:'.runner/mobile-'+label.replaceAll(' ','-')+'.png',fullPage:true});}
 for(const width of [390,320])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:844});await page.emulateMedia({colorScheme:theme,forcedColors:'none'});
  for(const view of ['map','birds','rules','settings','leagues']){
   await page.goto('http://127.0.0.1:4197/?view='+view);await page.waitForTimeout(500);await inspect(`${width} ${theme} ${view}`);
  }
  for(const stage of ['lobby','draft','ready','race']){
   league.status=stage==='race'?'ready':stage;league.year=stage==='race'?2026:2027;league.picks=stage==='draft'||stage==='lobby'?[]:birds.slice(0,6).map((b,i)=>({birdId:b.id,bird:b,userId:i<3?'audit-alice':'audit-bob'}));
   league.standings=stage==='race'?{year:2026,status:'complete',teams:league.members.map((m,i)=>({userId:m.id,name:m.name,rank:1,arrivals:1,points:5.5})),birds:league.picks.map((p,i)=>({...p,rank:i<2?1:null,points:i<2?5.5:0,status:i<2?'arrived':'nonfinisher',arrival:i<2?{observedAt:'2026-03-03T12:00:00Z'}:null}))}:undefined;
   await page.goto('http://127.0.0.1:4197/?view=leagues&league=audit-league');await page.waitForTimeout(500);
   if(stage==='ready'){await page.getByRole('button',{name:/Trade with:/}).click();await page.getByRole('listbox',{name:'Trade with'}).getByRole('option',{name:'Bob',exact:true}).click();}
   if(stage==='race'){const summary=page.locator('.race-disclosure summary').filter({hasText:'Bird arrivals'});await summary.click();}
   await inspect(`${width} ${theme} ${stage}`);
  }
  await page.goto('http://127.0.0.1:4197/?view=map');await page.locator('.birdrow').first().waitFor();
  const map=page.locator('.map-interaction-layer');await map.scrollIntoViewIfNeeded();
  if(context.browser().browserType().name()==='chromium'){
   const cdp=await context.newCDPSession(page),r=await map.boundingBox(),x=r.x+r.width/2,y=r.y+r.height/2,before=await map.getAttribute('data-camera');
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+45,y:y+25}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(150);
   assert.notEqual(await map.getAttribute('data-camera'),before,'one-finger pan changes map camera');
   const panned=await map.getAttribute('data-camera');await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x-25,y,id:1},{x:x+25,y,id:2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-60,y,id:1},{x:x+60,y,id:2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(150);
   assert.notEqual(await map.getAttribute('data-camera'),panned,'two-finger pinch changes zoom');await cdp.detach();
  }
  await page.getByRole('button',{name:'Zoom out',exact:true}).tap();
  await page.locator('.birdrow').first().tap();await page.locator('.profile-timeline input[type=range]').waitFor();
  await inspect(`${width} ${theme} profile`);
  await page.getByRole('button',{name:/Manage lists for/}).tap();await page.locator('.lists-dialog').waitFor();await page.locator('.list-create-disclosure summary').tap();await inspect(`${width} ${theme} lists`);await page.getByRole('button',{name:'Close lists',exact:true}).tap();
  const range=page.locator('.profile-timeline input[type=range]');await range.scrollIntoViewIfNeeded();const box=await range.boundingBox();await page.touchscreen.tap(box.x+box.width*.35,box.y+box.height/2);
  assert.ok(Number(await range.inputValue())<Number(await range.getAttribute('max')),'tap scrubber changes replay time');
  await page.getByRole('combobox',{name:'Playback speed'}).selectOption('1');await page.getByRole('button',{name:'Play migration playback',exact:true}).tap();await page.getByRole('button',{name:'Pause migration playback',exact:true}).tap();
  await page.getByRole('button',{name:'Follow bird',exact:true}).tap();assert.equal(await page.getByRole('button',{name:'Follow bird',exact:true}).getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:'Close bird profile',exact:true}).tap();assert.equal(await page.locator('.profile-inline').count(),0);
  await page.goto('http://127.0.0.1:4197/?view=settings');await page.locator('.account-privacy summary').tap();await page.getByText('Report a bug',{exact:true}).tap();await inspect(`${width} ${theme} expanded-settings`);
  await page.goto('http://127.0.0.1:4197/?view=rules');await page.locator('.how-to-play details summary').first().tap();await inspect(`${width} ${theme} expanded-rules`);
 }
 await page.setViewportSize({width:844,height:390});await page.goto('http://127.0.0.1:4197/?view=map');await page.waitForTimeout(500);await inspect('landscape map');
 fs.writeFileSync('.runner/mobile-ux-findings.json',JSON.stringify(findings,null,2));
}
