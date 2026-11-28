import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import http from 'node:http';
import{build}from'esbuild';import{chromium,firefox}from'playwright';
import{notificationDefaults}from'../lib/notifications.mjs';
const out=path.resolve('.runner/new-player');fs.mkdirSync(out,{recursive:true});
await build({entryPoints:['tests/fixtures/new-player-entry.tsx'],outfile:out+'/app.js',bundle:true,format:'esm',jsx:'automatic',loader:{'.svg':'dataurl'},define:{'process.env.NODE_ENV':'"development"'}});
await build({entryPoints:['lib/trail-worker.ts'],outfile:out+'/trail-worker.ts',bundle:true,format:'esm'});
fs.writeFileSync(out+'/index.html','<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated new-player walkthrough</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://local').pathname;let file;for(const root of[out,path.resolve('public')]){const p=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(p.startsWith(root+path.sep)&&fs.existsSync(p)&&fs.statSync(p).isFile()){file=p;break;}}if(!file){res.writeHead(404);return res.end();}res.setHeader('Content-Type',file.endsWith('.css')?'text/css':/\.(js|ts)$/.test(file)?'application/javascript':file.endsWith('.webp')?'image/webp':'text/html');fs.createReadStream(file).pipe(res);});
await new Promise(r=>server.listen(4199,'127.0.0.1',r));
const browser=await(process.env.AUDIT_BROWSER==='firefox'?firefox.launch():chromium.launch(process.platform==='win32'&&process.env.AUDIT_BROWSER!=='chromium'?{channel:'msedge'}:{}));
const results=[];const now=Date.parse('2026-11-28T12:00:00Z');
try{for(const width of[1440,390,320])for(const theme of['light','dark']){
 const context=await browser.newContext({viewport:{width,height:900},colorScheme:theme,serviceWorkers:'block'});const page=await context.newPage(),errors=[],external=[];
 await context.addInitScript(({now})=>{const RealDate=Date;window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};},{now});
 page.on('pageerror',e=>errors.push(e.message));
 const birds=Array.from({length:4},(_,i)=>({id:'new-bird-'+i,name:['Éloïse-Anne','Long named stork','Bernard','Jack'][i],studyId:'isolated',country:'Spain',countryCode:'ES',latitude:37+i*.1,longitude:-5+i*.1,latestValidFixUtc:new Date(now).toISOString(),distanceToGermanyMiles:900,currentDeployment:true,portraitId:144+i}));
 const league={id:'welcome-league',name:'First flock',owner:'host',invite:'001234',year:2027,status:'lobby',size:2,members:[{id:'host',name:'Host'}],picks:[],trades:[]};
 let joined=false,joinAttempts=0,pickAttempts=0,failJoin=true,invalidCode=false,items=[];
 await context.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());if(u.origin!=='http://127.0.0.1:4199'){external.push(u.origin);return route.abort();}if(!u.pathname.startsWith('/api/'))return route.continue();const send=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if(u.pathname==='/api/birds')return send({birds,asOf:new Date(now).toISOString(),sources:[]});
  if(u.pathname==='/api/lists')return send({lists:[]});
  if(u.pathname==='/api/history')return send(u.searchParams.has('rankings')?{rankings:{}}:{records:2,years:[2026],migration:{successes:0,attempts:0,seasons:[],pendingYears:0},state:{complete:true},points:[]});
  if(u.pathname==='/api/leagues'){
   if(req.method()==='POST'){const b=req.postDataJSON();assert.equal(req.headers().authorization,'Bearer isolated-player-token');if(b.action==='join'){joinAttempts++;if(invalidCode)return send({error:'Invite not found or joining has closed.'},404);assert.equal(b.invite,'001234');if(failJoin){failJoin=false;return send({error:'Temporarily unavailable. Please retry.'},503);}await new Promise(r=>setTimeout(r,150));if(!joined)league.members.push({id:'new-player',name:'NewPlayer'});joined=true;return send({league});}if(b.action==='pick'){pickAttempts++;assert.equal(b.id,league.id);assert.ok(!league.picks.some(p=>p.birdId===b.birdId));league.picks.push({birdId:b.birdId,bird:birds.find(x=>x.id===b.birdId),userId:'new-player'});return send({league});}return send({error:'Unexpected write'},400);}
   return send({signedIn:true,userId:'new-player',leagues:joined?[league]:[]});
  }
  if(u.pathname==='/api/notifications'){if(req.method()==='POST'){const b=req.postDataJSON();assert.equal(b.action,'read');items=items.map(x=>x.id===b.id?{...x,read:true}:x);}return send({items,unread:items.filter(x=>!x.read).length,preferences:notificationDefaults,emailReady:true});}
  throw Error('Unexpected endpoint '+u.pathname);
 });
 async function layout(stage){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${width} ${theme} ${stage} overflow`);await page.screenshot({path:`${out}/${width}-${theme}-${stage}.png`,fullPage:true});}
 await page.goto('http://127.0.0.1:4199/?invite=001234');
 const hub=page.getByRole('region',{name:'My leagues'});await hub.getByText('Your flock starts here.',{exact:true}).waitFor();await layout('signed-out');
 await hub.getByRole('button',{name:'Sign in with Google or email'}).click();
 const code=page.getByLabel('Invite code',{exact:true}),join=hub.locator('form').getByRole('button',{name:'Join league',exact:true});await code.waitFor();assert.equal(await code.inputValue(),'001234');assert.ok(await join.isDisabled());
 await page.evaluate(()=>window.setFixtureUsername('OverlongUsername12345'));assert.ok(await join.isDisabled());
 await page.evaluate(()=>window.setFixtureUsername('NewPlayer'));await page.waitForFunction(()=>!document.querySelector('.league-entry-body form button').disabled);assert.equal(await code.inputValue(),'001234');await layout('join');
 await code.fill('12');assert.equal(await code.evaluate(e=>e.checkValidity()),false);
 invalidCode=true;await code.fill('999999');await join.click();await page.getByText('Invite not found or joining has closed.',{exact:true}).waitFor();assert.equal(joined,false);invalidCode=false;await code.fill('001234');
 await join.click();await page.getByText('Temporarily unavailable. Please retry.',{exact:true}).waitFor();assert.equal(await code.inputValue(),'001234');assert.equal(joinAttempts,2);
 await join.evaluate(e=>{e.click();e.click();});await page.getByRole('heading',{name:'First flock',exact:true}).waitFor();assert.equal(joinAttempts,3);assert.equal(league.members.filter(m=>m.id==='new-player').length,1);await layout('lobby');
 league.status='draft';league.members=[league.members[1],league.members[0]];
 items=[{id:'turn-1',title:'Your turn to draft',body:'Choose a stork for your first flock.',leagueName:league.name,leagueId:league.id,createdAt:now,read:false,active:true,actionable:true}];
 // Simulate the host starting the draft while the new player is on another tab.
 await page.getByRole('button',{name:'How to play',exact:true}).click();await page.getByRole('button',{name:'Notifications',exact:true}).click();await page.getByRole('button',{name:/Your turn to draft/}).click();
 // The regular league refresh picks up the host change; no player write is needed.
 await page.evaluate(()=>{document.dispatchEvent(new Event('visibilitychange'));});
 await page.getByRole('heading',{name:'You’re on the clock.',exact:true}).waitFor();
 const draft=page.getByRole('button',{name:'Draft this stork',exact:true});assert.ok(await draft.isDisabled());await page.getByRole('searchbox',{name:'Search draftable storks'}).fill('Éloïse');await page.locator('.draft-bird').first().click();assert.ok(await draft.isEnabled());await layout('draft');await draft.click();
 await page.getByRole('button',{name:'Waiting for your turn',exact:true}).waitFor();assert.equal(pickAttempts,1);assert.equal(league.picks.length,1);await layout('picked');
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('checkbox',{name:'Draft & league stages — In-app',exact:true}).waitFor();
 for(const box of await page.getByRole('checkbox',{name:/— In-app$/}).all())assert.ok(await box.isChecked());for(const box of await page.getByRole('checkbox',{name:/— Email$/}).all())assert.equal(await box.isChecked(),false);await layout('settings');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);results.push({width,theme,joinAttempts,pickAttempts,passed:true});await context.close();
 }
 console.log(JSON.stringify({scenarios:results.length,results,externalRequests:0,realEmails:0}));
}finally{await browser.close();server.close();}
