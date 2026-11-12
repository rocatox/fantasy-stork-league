import assert from 'node:assert/strict';

export async function checkAccountLayout({page,scan}){
 for(const theme of ['light','dark'])for(const width of [1280,768,651,650,390,320]){
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme,forcedColors:'none'});
  await page.goto('http://127.0.0.1:4197/?view=settings&longAccount=1');
  const row=page.locator('.settings-account-row');await row.waitFor();
  const identity=await row.locator('.settings-account').boundingBox(),actions=await row.locator('.settings-account-actions').boundingBox();
  assert.ok(identity&&actions);
  if(width>650){assert.ok(actions.x>=identity.x+identity.width+18,'desktop actions clear long identity text');assert.ok(Math.abs(identity.y+identity.height/2-actions.y-actions.height/2)<2,'desktop vertical alignment');}
  else assert.ok(actions.y>=identity.y+identity.height+10,'mobile actions below identity');
  assert.equal(await row.evaluate(el=>el.scrollWidth>el.clientWidth+1),false,'no account overflow');
  for(const button of await row.getByRole('button').all())assert.ok((await button.boundingBox()).height>=40);
  await scan(`long account ${theme} ${width}`);
  await row.locator('..').screenshot({path:`.runner/account-${theme}-${width}.png`});
 }
 await page.setViewportSize({width:1440,height:1000});await page.emulateMedia({colorScheme:'light',forcedColors:'none'});
}
