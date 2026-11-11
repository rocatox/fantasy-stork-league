import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import {build} from 'esbuild';import {createRequire} from 'node:module';
import {notificationDefaults} from '../lib/notifications.mjs';
import {checkStorkNotifications} from './stork-notification-ui.mjs';
const require=createRequire(import.meta.url),{chromium,firefox}=require('playwright');
const out=path.resolve('.runner/desktop-ui');fs.mkdirSync(out,{recursive:true});
await build({entryPoints:['tests/fixtures/desktop-entry.tsx'],outfile:out+'/app.js',bundle:true,format:'esm',jsx:'automatic',loader:{'.svg':'dataurl'},define:{'process.env.NODE_ENV':'"development"'}});
await build({entryPoints:['lib/trail-worker.ts'],outfile:out+'/trail-worker.ts',bundle:true,format:'esm'});
fs.writeFileSync(out+'/index.html','<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated desktop audit</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
const server=http.createServer((req,res)=>{const name=decodeURIComponent(new URL(req.url,'http://local').pathname);const roots=[out,path.resolve('public')];let file;for(const root of roots){const p=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(p.startsWith(root+path.sep)&&fs.existsSync(p)&&fs.statSync(p).isFile()){file=p;break;}}if(!file){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.css')?'text/css':/\.(js|ts)$/.test(file)?'application/javascript':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.png')?'image/png':'text/html');fs.createReadStream(file).pipe(res);});
await new Promise(r=>server.listen(4197,'127.0.0.1',r));
const browser=await (process.env.AUDIT_BROWSER==='firefox'?firefox.launch({headless:true}):chromium.launch({...(process.platform==='win32'&&process.env.AUDIT_BROWSER!=='chromium'?{channel:'msedge'}:{}),headless:true}));const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});let page=await context.newPage();
// Pin the fixture season so January deadlines cannot make CI change with the calendar.
const now=Date.parse('2026-11-08T12:00:00Z');
await context.addInitScript(({now})=>{const RealDate=Date;class FixtureDate extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}window.Date=FixtureDate;},{now});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const birds=Array.from({length:12},(_,i)=>({id:'audit-'+i,name:'Research Stork '+(i+1),country:'Spain',longitude:-5+i*.4,latitude:37+i*.2,distanceToGermanyMiles:900,latestValidFixUtc:new Date(now).toISOString(),currentDeployment:true,sex:'f',sourceUrl:'https://example.test/study',studyId:'audit',portraitId:i+1}));
const migration={successes:2,attempts:3,typicalArrival:'03-20',arrivalSpreadDays:4,pendingYears:0,seasons:[{year:2025,attempt:true,arrival:'2025-03-20T12:00:00Z'}]};
const league={id:'audit-league',name:'Isolated audit league',owner:'audit-alice',invite:'012345',year:2027,status:'ready',size:3,members:[{id:'audit-alice',name:'Alice'},{id:'audit-bob',name:'Bob'}],picks:birds.slice(0,6).map((b,i)=>({birdId:b.id,bird:b,userId:i<3?'audit-alice':'audit-bob'})),trades:[]};
let historyGate=null,releaseHistory=null;let leagueWrites=0;let failNotifications=false,failBirds=false,failHistory=false,failLeague=false;
let items=Array.from({length:13},(_,i)=>({id:'n'+i,title:'Trade proposal',body:'Bob offered a trade. Review the birds in your league before accepting.',leagueName:league.name,leagueId:league.id,createdAt:now-i*60000,read:false,active:true}));
await context.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());if(u.origin!=='http://127.0.0.1:4197'){await route.abort();return;}if(!u.pathname.startsWith('/api/')){await route.continue();return;}
 const send=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 if(u.pathname==='/api/birds')return failBirds?send({error:'offline fixture'},503):send({birds,asOf:new Date(now).toISOString(),sources:[],syncActive:true});
 if(u.pathname==='/api/leagues'){if(req.method()==='POST'){leagueWrites++;await new Promise(r=>setTimeout(r,200));}return failLeague?send({error:'League request failed; retry.'},503):send({signedIn:true,userId:'audit-alice',leagues:[league],league});}
 if(u.pathname==='/api/account'&&req.method()==='POST'){assert.deepEqual(req.postDataJSON(),{action:'delete',confirmation:'DELETE'});return send({accepted:true,status:'cleanup'});}
 if(u.pathname==='/api/bug-reports'&&req.method()==='POST')return send({id:req.postDataJSON().id});
 if(u.pathname==='/api/lists')return send({lists:[{id:'mvp',name:'MVPs',icon:'trophy',birdIds:['audit-1']}]});
 if(u.pathname==='/api/notifications'){if(failNotifications&&req.method()==='POST')return send({error:'Unable to mark notification read.'},503);if(req.method()==='POST'){const b=req.postDataJSON();if(b.action==='readAll')items=items.map(x=>({...x,read:true}));if(b.action==='read')items=items.map(x=>x.id===b.id?{...x,read:true}:x);}return send({items,unread:items.filter(x=>!x.read).length,preferences:notificationDefaults,emailReady:true});}
 if(u.pathname==='/api/history'){if(historyGate&&!u.searchParams.has('rankings'))await historyGate;if(failHistory)return send({error:'History unavailable'},503);if(u.searchParams.has('rankings'))return send({rankings:Object.fromEntries(birds.map(b=>[b.id,migration]))});return send({records:3,years:[2025],first:'2025-01-01T00:00:00Z',state:{complete:true},migration,points:[[-5,37,new Date(now-86400000).toISOString()],[-4,38,new Date(now).toISOString()]]});}
 return send({ok:true});
});
const results=[];
async function scan(label){await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});const a=await page.evaluate(async()=>await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']},rules:matchMedia('(forced-colors: active)').matches?{'color-contrast':{enabled:false}}:{}}));results.push({label,violations:a.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary})).slice(0,8)})),overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)});}
try{
 const priorItems=items;await checkStorkNotifications({page,now,setItems:value=>{items=value;},scan,results});items=priorItems;
 if(process.env.AUDIT_STORK_ONLY==='true'){
  const failures=results.filter(r=>r.passed===false||r.overflow||r.violations?.length);console.log(JSON.stringify({checks:results.length,failures,errors},null,2));
  await browser.close();server.close();assert.equal(failures.length,0);assert.equal(errors.length,0);process.exit(0);
 }
 if(process.env.AUDIT_PRIVACY_ONLY!=='true'){
 for(const theme of ['light','dark']){await page.emulateMedia({colorScheme:theme});for(const view of ['rules','settings','birds','leagues','map']){await page.goto('http://127.0.0.1:4197/?view='+view+(view==='leagues'?'&league=audit-league':''));await page.waitForTimeout(1300);await scan(theme+' '+view);}}
 for(const width of [1440,390])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme:theme});await page.goto('http://127.0.0.1:4197/?view=settings');
  await page.getByRole('checkbox',{name:'Stork updates — In-app',exact:true}).waitFor();
  const email=await page.getByRole('checkbox',{name:'Trades — Email',exact:true}).boundingBox(),inapp=await page.getByRole('checkbox',{name:'Trades — In-app',exact:true}).boundingBox();
  results.push({label:`${theme} ${width} notification columns`,passed:email.x<inapp.x&&await page.getByRole('checkbox',{name:'Stork updates — Email',exact:true}).count()===0});await page.getByRole('button',{name:'How to play',exact:true}).hover();await scan(`${theme} ${width} stork update settings`);
 }
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('http://127.0.0.1:4197/?view=leagues&league=audit-league');await page.waitForTimeout(1000);
 
 await page.getByRole('button',{name:/Stork to swap out:/}).focus();await page.keyboard.press('Enter');
 await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');results.push({label:'nonsearch dropdown arrows and Enter',passed:(await page.getByRole('button',{name:/Stork to swap out:/}).innerText()).includes('Research Stork 3')});
 await page.getByRole('button',{name:/Stork to swap in:/}).click();await page.getByRole('combobox',{name:'Search available stork'}).fill('12');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');results.push({label:'search dropdown keyboard selection',passed:(await page.getByRole('button',{name:/Stork to swap in:/}).innerText()).includes('12')});
 await page.getByRole('button',{name:/Stork to swap in:/}).click();await page.keyboard.press('Escape');results.push({label:'dropdown Escape restores focus',passed:await page.getByRole('button',{name:/Stork to swap in:/}).evaluate(e=>e===document.activeElement)});
 
 
 await page.locator('.pool-swap-row button.primary').evaluate(e=>{e.click();e.click();});await page.waitForTimeout(500);results.push({label:'double swap submit sends once',passed:leagueWrites===1});
 await page.getByRole('button',{name:/Notifications/}).click();await page.getByRole('button',{name:'Load older'}).click();await scan('notification dialog');
 
 await page.keyboard.press('Escape');results.push({label:'dialog Escape returns focus',passed:await page.getByRole('button',{name:/Notifications/}).evaluate(e=>e===document.activeElement)});await page.getByRole('button',{name:/Notifications/}).click();failNotifications=true;await page.locator('.notification-item').first().click();results.push({label:'failed notification read retains dialog',passed:await page.locator('dialog.notifications-dialog').evaluate(d=>d.open)});
 
 await page.waitForTimeout(100);results.push({label:'failed read announces error',passed:await page.getByRole('alert').filter({hasText:'Unable to mark'}).count()===1});failNotifications=false;await page.locator('.notification-item').first().click();await page.waitForTimeout(200);results.push({label:'successful read opens league',passed:await page.locator('dialog.notifications-dialog').evaluate(d=>!d.open)});
 await page.goto('http://127.0.0.1:4197/?view=map');await page.waitForTimeout(900);results.push({label:'new skip-link behavior rolled back',passed:await page.locator('.skip-link').count()===0});
 failHistory=true;await page.locator('.birdrow').first().click();await page.waitForTimeout(600);results.push({label:'history failure retry offered',passed:await page.getByRole('button',{name:'Retry history',exact:true}).count()===1});failHistory=false;await page.getByRole('button',{name:'Retry history',exact:true}).click();await page.waitForTimeout(400);results.push({label:'history retry recovers',passed:await page.locator('.migration-highlights').count()>0});await page.getByRole('button',{name:'Close bird profile'}).click();results.push({label:'profile closes without focus restoration',passed:await page.locator('.profile-inline').count()===0&&await page.evaluate(()=>!document.activeElement?.matches('.birdrow,[data-bird]'))});

 await page.setViewportSize({width:1440,height:800});
 await page.goto('http://127.0.0.1:4197/?view=map');await page.waitForTimeout(800);
 await page.locator('.birdrow').first().click();await page.waitForTimeout(1200);
 results.push({label:'selection reveals only timeline controls',passed:await page.locator('.profile-timeline .migration-timeline.timeline-compact').evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=-1&&r.bottom<=innerHeight+1&&r.bottom>=innerHeight-32;})});
 await page.evaluate(()=>window.scrollBy(0,150));await page.waitForTimeout(100);
 const beforeSwitch=await page.evaluate(()=>scrollY);
 await page.locator('.birdrow').nth(1).evaluate(e=>e.click());await page.waitForTimeout(1200);
 results.push({label:'visible timeline does not scroll on bird switch',passed:Math.abs(await page.evaluate(()=>scrollY)-beforeSwitch)<2});
 await page.mouse.move(30,400);await page.mouse.wheel(0,-100);await page.waitForTimeout(500);
 const afterWheel=await page.evaluate(()=>scrollY);await page.waitForTimeout(700);
 results.push({label:'selection scroll settles and does not fight later scrolling',passed:Math.abs(await page.evaluate(()=>scrollY)-afterWheel)<2});

 // Fresh navigation clears the in-memory full-trail cache. Delay both history
 // endpoints and use real wheel/keyboard input before the timeline can mount.

 for(const gesture of ['page wheel','scouting wheel','PageDown']){
  historyGate=new Promise(resolve=>{releaseHistory=resolve;});
  await page.goto('http://127.0.0.1:4197/?view=map');await page.waitForTimeout(600);
  await page.evaluate(()=>{window.revealCalls=0;const original=window.scrollBy;window.scrollBy=function(...args){window.revealCalls++;return original.apply(this,args);};});
  await page.locator('.birdrow').first().click();
  assert.equal(await page.locator('.profile-timeline .migration-timeline.timeline-compact').count(),0,'history must still be loading');
  if(gesture==='PageDown')await page.keyboard.press('PageDown');
  else {if(gesture==='scouting wheel'){const b=await page.locator('.birdlist').boundingBox();await page.mouse.move(b.x+b.width/2,b.y+150);}else await page.mouse.move(20,400);await page.mouse.wheel(0,160);}
  await page.waitForTimeout(500);
  const before=await page.evaluate(()=>({page:scrollY,list:document.querySelector('.birdlist').scrollTop}));
  releaseHistory();historyGate=null;
  await page.locator('.profile-timeline .migration-timeline.timeline-compact').waitFor();await page.waitForTimeout(800);
  const after=await page.evaluate(()=>({page:scrollY,list:document.querySelector('.birdlist').scrollTop,reveals:window.revealCalls}));
  results.push({label:gesture+' during loading cancels late reveal',passed:after.reveals===0&&Math.abs(after.page-before.page)<8&&Math.abs(after.list-before.list)<2&&(gesture==='scouting wheel'?before.list>0:before.page>0),before,after});
 }
 historyGate=null;
 await page.setViewportSize({width:1440,height:1000});
 failBirds=true;await page.goto('http://127.0.0.1:4197/?view=map');await page.waitForTimeout(400);results.push({label:'failed roster offers retry',passed:await page.getByRole('button',{name:'Retry tracking'}).count()===1});failBirds=false;await page.getByRole('button',{name:'Retry tracking'}).click();await page.waitForTimeout(600);results.push({label:'roster retry recovers',passed:await page.locator('.birdrow').count()===12});
 await page.setViewportSize({width:720,height:500});for(const view of ['rules','settings','leagues','map']){await page.goto('http://127.0.0.1:4197/?view='+view+(view==='leagues'?'&league=audit-league':''));await page.waitForTimeout(600);results.push({label:'200% equivalent '+view,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)});}
 
 await page.setViewportSize({width:1440,height:1000});
 for(const stage of ['lobby','draft','ready']){league.status=stage;if(stage==='draft')league.picks=[];if(stage==='ready'){league.year=2026;league.picks=birds.slice(0,6).map((b,i)=>({birdId:b.id,bird:b,userId:i<3?'audit-alice':'audit-bob'}));}await page.goto('http://127.0.0.1:4197/?view=leagues&league=audit-league');await page.waitForTimeout(700);await scan('league stage '+stage);}
 await page.goto('http://127.0.0.1:4197/?view=map');await page.waitForTimeout(1200);failBirds=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForTimeout(400);results.push({label:'cached roster remains on failed refresh',passed:await page.locator('.birdrow').count()===12});failBirds=false;
 
 await page.getByRole('button',{name:/List:/}).count();
 await page.getByRole('button',{name:/Sort storks:/}).click();await page.keyboard.press('End');await page.keyboard.press('Enter');results.push({label:'sort menu keyboard End and Enter',passed:(await page.getByRole('button',{name:/Sort storks:/}).innerText()).includes('Name A')});
 
 await page.goto('http://127.0.0.1:4197/?view=settings');await page.waitForTimeout(600);await page.evaluate(()=>window.failPreference=true);await page.getByRole('button',{name:'Light',exact:true}).click();await page.waitForTimeout(200);results.push({label:'failed preference offers retry',passed:await page.getByRole('button',{name:'Retry save'}).count()===1});await page.evaluate(()=>window.failPreference=false);await page.getByRole('button',{name:'Retry save'}).click();await page.waitForTimeout(200);results.push({label:'preference retry recovers',passed:await page.getByRole('button',{name:'Retry save'}).count()===0});
 await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('combobox',{name:'Motion preference'}).selectOption('system');await page.waitForTimeout(100);results.push({label:'system reduced motion applied',passed:await page.evaluate(()=>document.documentElement.dataset.reducedMotion==='true')});

 // Forced colors and screen-reader semantics use the real components and synthetic API only.
 league.status='ready';league.year=2027;
 for(const scheme of ['light','dark']){
  await page.emulateMedia({forcedColors:'active',colorScheme:scheme});
  for(const view of ['map','birds','leagues','settings','rules']){
   await page.goto('http://127.0.0.1:4197/?view='+view+(view==='leagues'?'&league=audit-league':''));await page.waitForTimeout(600);await scan('forced colors '+scheme+' '+view);await page.screenshot({path:'.runner/forced-'+scheme+'-'+view+'.png'});
  }
 }
 await page.goto('http://127.0.0.1:4197/?view=leagues&league=audit-league');await page.waitForTimeout(700);
 await page.getByRole('button',{name:/Stork to swap in:/}).click();
 const search=page.getByRole('combobox',{name:'Search available stork'});
 await search.fill('Research');await search.press('Home');
 results.push({label:'search Home keeps native caret behavior',passed:await search.evaluate(e=>e.selectionStart===0&&!e.hasAttribute('aria-activedescendant'))});
 await search.press('End');await search.press('ArrowDown');
 results.push({label:'active descendant resolves to an option',passed:await search.evaluate(e=>document.getElementById(e.getAttribute('aria-activedescendant'))?.getAttribute('role')==='option')});
 await search.fill('no matches');
 results.push({label:'empty search clears active descendant and announces no results',passed:!(await search.getAttribute('aria-activedescendant'))&&await page.getByRole('status').filter({hasText:'No matching storks'}).count()===1});
 await search.fill('Research');await search.press('ArrowDown');
 results.push({label:'forced colors keyboard option has visible outline',passed:await page.locator('[role=option][data-active=true]').evaluate(e=>getComputedStyle(e).outlineStyle==='solid')});
 await page.screenshot({path:'.runner/forced-colors-dropdown.png',fullPage:false});await page.keyboard.press('Escape');
 await page.getByRole('button',{name:/Notifications/}).click();await scan('forced colors notification dialog');await page.keyboard.press('Escape');
 await page.goto('http://127.0.0.1:4197/?view=map');await page.waitForTimeout(900);
 await page.locator('.birdrow').first().click();await page.waitForTimeout(600);
 const timeline=page.getByRole('slider',{name:'Migration timeline'});
 results.push({label:'timeline exposes readable date instead of only epoch value',passed:/Timeline .*UTC/.test(await timeline.getAttribute('aria-valuetext'))});
 await timeline.focus();await page.keyboard.press('Home');
 results.push({label:'timeline Home reaches start',passed:await timeline.evaluate(e=>e.value===e.min)});
 results.push({label:'selected row survives forced palette',passed:await page.locator('.birdrow-selected').evaluate(e=>getComputedStyle(e).outlineStyle==='solid')});
 await page.emulateMedia({forcedColors:'active',colorScheme:'dark'});await page.screenshot({path:'.runner/forced-colors-profile.png'});
 await page.emulateMedia({forcedColors:'none'});

 await page.goto('http://127.0.0.1:4197/?view=leagues&league=audit-league');await page.waitForTimeout(1000);
 }
 // Release the map-heavy rehearsal page before the independent settings checks.
 await page.close();page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4197/?view=settings');
 for(const theme of ['light','dark'])for(const width of [1280,390]){
  console.log('Privacy fixture',theme,width);
  await page.emulateMedia({colorScheme:theme,forcedColors:'none'});await page.setViewportSize({width,height:900});
  await page.evaluate(()=>localStorage.removeItem('stork-preferences:audit-alice'));
  await page.goto('http://127.0.0.1:4197/?view=settings&section=privacy');await page.waitForTimeout(600);
  assert.equal(await page.locator('.account-privacy').getAttribute('open'),'');
  assert.equal(await page.locator('html').getAttribute('data-theme'),theme);
  await scan(`privacy ${theme} ${width}`);
  await page.locator('.account-privacy input[type=email]').fill('isolated@example.test');
  await page.locator('.account-privacy textarea').fill('Synthetic privacy request. Do not send email.');
  await page.getByRole('button',{name:'Send private request',exact:true}).click();
  await page.getByText('Your request was saved privately for review. No account changes have been made.').waitFor();
  results.push({label:`privacy receipt ${theme} ${width}`,passed:true});
  await page.locator('.account-delete summary').click();
  const deletionButton=page.getByRole('button',{name:'Permanently delete my account',exact:true});
  assert.ok(await deletionButton.isDisabled());await page.locator('.account-delete input').fill('DELETE');assert.ok(await deletionButton.isEnabled());
  await scan(`delete confirmation ${theme} ${width}`);
  await deletionButton.click();await page.getByText('Deletion has started.',{exact:false}).waitFor();
  assert.equal(await page.evaluate(()=>localStorage.getItem('stork-preferences:audit-alice')),null);
  results.push({label:`isolated deletion receipt ${theme} ${width}`,passed:true});
 }
 await page.screenshot({path:'.runner/desktop-settings-verified.png',fullPage:true});
 fs.writeFileSync('.runner/desktop-audit-results.json',JSON.stringify({results,errors},null,2));console.log(JSON.stringify({checks:results.length,failures:results.filter(r=>r.passed===false||r.overflow||r.violations?.length),errors},null,2));assert.equal(errors.length,0);for(const r of results){assert.notEqual(r.passed,false,r.label);assert.notEqual(r.overflow,true,r.label);assert.equal(r.violations?.length||0,0,r.label);}
}finally{await browser.close();server.close();}
