import assert from 'node:assert/strict';
export async function checkStorkNotifications({page,now,setItems,scan,results}){
 const longName='Frensdorf North Meadow Riverside Wanderer 123';
 const fixtures=[
  {id:'memorial',title:'Remembering '+longName,body:`On November 2, 2026, ${longName} passed away. May we keep them in our hearts.`},
  {id:'discovery',title:'A new stork to scout',body:'Moenchsambach Faraway Winter Wanderer 987 has joined the app. Explore their profile and migration history.'},
  {id:'unknown-date',title:'Remembering VeryLongUnbrokenSyntheticStorkNameForWrappingChecks12345',body:'We learned that VeryLongUnbrokenSyntheticStorkNameForWrappingChecks12345 passed away. May we keep them in our hearts.'}
 ].map(e=>({...e,category:'storks',createdAt:now,read:false,active:true,actionable:false,emailSuppressed:true}));
 for(const width of [1440,390,320])for(const theme of ['light','dark']){
  setItems(structuredClone(fixtures));await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme,forcedColors:'none'});
  await page.goto('http://127.0.0.1:4197/?view=settings');await page.waitForTimeout(300);
  await page.getByRole('button',{name:/^Notifications/}).click();
  const dialog=page.locator('.notifications-dialog');await dialog.getByText('Remembering '+longName,{exact:true}).waitFor();
  assert.equal(await page.locator('html').getAttribute('data-theme'),theme);
  await scan(`stork inbox ${theme} ${width}`);
  assert.equal(await dialog.locator('.notification-meta').filter({hasText:'Stork updates'}).count(),3);
  assert.equal(await dialog.getByText('View league →',{exact:true}).count(),0);
  const layout=await dialog.evaluate(d=>({overflow:d.scrollWidth>d.clientWidth+1,clipped:[...d.querySelectorAll('.notification-title-row,.notification-body')].some(e=>e.scrollWidth>e.clientWidth+1)}));
  results.push({label:`long stork messages ${theme} ${width}`,passed:!layout.overflow&&!layout.clipped});
  await page.screenshot({path:`.runner/stork-inbox-${theme}-${width}.png`});
  await dialog.locator('.notifications-pagination').scrollIntoViewIfNeeded();
  assert.ok(await dialog.locator('.notifications-pagination').evaluate(e=>{const a=e.getBoundingClientRect(),d=e.closest('dialog').getBoundingClientRect();return a.top>=d.top&&a.bottom<=d.bottom+1;}),'bottom of inbox remains reachable');
  await page.mouse.click(2,2);assert.equal(await dialog.evaluate(d=>d.open),false,'outside tap closes inbox');
  await page.getByRole('button',{name:/^Notifications/}).click();
  await dialog.locator('.notification-item').first().click();assert.equal(await dialog.evaluate(d=>d.open),false);
  assert.ok(page.url().includes('view=settings'),'global stork notice does not navigate to a missing league');
  await page.getByRole('button',{name:/^Notifications/}).click();assert.equal(await dialog.locator('.notification-item').count(),2);
  await dialog.getByRole('button',{name:'Mark all read',exact:true}).click();await dialog.getByText('You’re all caught up.').waitFor();
  await dialog.getByRole('button',{name:'Show read',exact:true}).click();assert.equal(await dialog.locator('.notification-item').count(),3);
  await dialog.getByRole('button',{name:'Close notifications',exact:true}).click();
  results.push({label:`stork inbox dismiss/read ${theme} ${width}`,passed:true});
 }
 await page.setViewportSize({width:1440,height:1000});await page.emulateMedia({colorScheme:'light'});
}
