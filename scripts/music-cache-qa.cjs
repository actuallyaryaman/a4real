// Run outside the restricted sandbox: node scripts/browser-qa.cjs
const fs = require('fs');
const path = require('path');
const os = require('os');
const {spawn}=require('child_process');
let playwright;
try { playwright = require('playwright'); }
catch {
  const cache = path.join(os.homedir(), '.npm', '_npx');
  for (const dir of fs.existsSync(cache) ? fs.readdirSync(cache) : []) {
    try { playwright = require(path.join(cache, dir, 'node_modules', 'playwright')); break; } catch {}
  }
}
if (!playwright) throw new Error('Playwright unavailable. Install it locally with npm install --no-save playwright.');
const assert=require('node:assert/strict');
(async()=>{
 const output=path.resolve('output/playwright/music');fs.mkdirSync(output,{recursive:true});
 const origin='https://music.example.test',endpoint=origin+'/api/now-playing',base='http://127.0.0.1:8014';
 const source=fs.readFileSync('dist/index.html','utf8').replace(/data-endpoint="[^"]*"/,`data-endpoint="${endpoint}"`);
 const image=fs.readFileSync('tests/fixtures/music-art.png');
 const track={status:'playing',checkedAt:new Date().toISOString(),track:{title:'Paper Rooms',artist:'Aster Vale',album:'Evening Notes',artwork:'https://lastfm.freetls.fastly.net/i/u/300x300/fixture.jpg',appleMusicUrl:'https://music.apple.com/in/album/123?i=456',appleMusicMatched:true}};
 const key='on-rotation:v2:'+origin;
 const browser=process.env.PORTFOLIO_CDP ? await playwright.chromium.connectOverCDP(process.env.PORTFOLIO_CDP) : await playwright.chromium.launch({executablePath:process.env.PORTFOLIO_BROWSER,headless:true});
 const server=spawn('python3',['-m','http.server','8014','--bind','127.0.0.1','--directory','dist'],{stdio:'ignore'});
 const report=[];
 try{
  for(let i=0;i<30;i++){try{await fetch(base+'/styles.css');break;}catch{await new Promise(r=>setTimeout(r,100));}}
  for(const width of [375,768,1440]){
   const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});
   const page=await context.newPage();let finish,mode='slow',calls=0;
   const release=new Promise(r=>finish=r);
   await context.addInitScript(({key,track})=>localStorage.setItem(key,JSON.stringify(track)),{key,track});
   await page.route(base+'/',r=>r.fulfill({contentType:'text/html',body:source}));
   await page.route('https://lastfm.freetls.fastly.net/**',r=>r.fulfill({contentType:'image/png',body:image}));
   await page.route(endpoint,async r=>{calls++;if(mode==='slow')await release;if(mode==='error')return r.fulfill({status:503,body:'down'});return r.fulfill({contentType:'application/json',body:JSON.stringify(track)}).catch(()=>{});});
   await page.goto(base+'/');
   assert.equal(await page.locator('[data-music-track]').textContent(),'Paper Rooms');
   assert.equal(await page.locator('[data-music-status]').textContent(),'Last seen');
   assert.equal(await page.locator('[data-music]').getAttribute('data-cached'),'true');
   assert(calls===1,'Stored paint must precede slow response');
   if(!process.env.PORTFOLIO_CDP)await page.locator('[data-music-art]').evaluate(img=>img.decode());
   const before=await page.locator('[data-music]').boundingBox();
   for(const selector of ['track','art-link','listen'])assert.equal(await page.locator(`[data-music-${selector}]`).getAttribute('href'),track.track.appleMusicUrl);
   assert.equal(await page.locator('.music-card a[href*="last.fm"]').count(),0);
   finish();await page.waitForFunction(()=>document.querySelector('[data-music-status]').textContent==='Now playing');
   const after=await page.locator('[data-music]').boundingBox();assert.equal(after.height,before.height);
   mode='error';await page.reload();assert.equal(await page.locator('[data-music-track]').textContent(),'Paper Rooms');
   await page.waitForTimeout(150);assert.equal(await page.locator('[data-music-status]').textContent(),'Last seen');
   if(process.env.PORTFOLIO_CDP){await page.evaluate(()=>window.dispatchEvent(new Event('offline')));}else{await context.setOffline(true);}assert.equal(await page.locator('[data-music-track]').textContent(),'Paper Rooms');if(!process.env.PORTFOLIO_CDP)await context.setOffline(false);
   assert((await page.evaluate(()=>document.documentElement.scrollWidth))<=width);
   await page.screenshot({path:path.join(output,`cached-${width}.png`),fullPage:true});
   await page.locator('[data-music]').screenshot({path:path.join(output,`cached-card-${width}.png`)});
   report.push({width,storedBeforeResponse:true,retainedOnError:true,offlineRetained:true,offlineMode:process.env.PORTFOLIO_CDP?'offline-event':'network-disconnected',appleLinks:3,layoutStable:true});await context.close();
  }
  // First visit, unsafe catalog links, expiry, denied storage, bounded progressive updates.
  for(const scenario of ['cold','expired','corrupt','blocked','enriching']){
   const context=await browser.newContext({viewport:{width:375,height:812}}),page=await context.newPage();let calls=0;
   if(scenario==='expired')await context.addInitScript(({key,track})=>{track.checkedAt=new Date(Date.now()-15*86400000).toISOString();localStorage.setItem(key,JSON.stringify(track));},{key,track});
   if(scenario==='corrupt')await context.addInitScript(key=>localStorage.setItem(key,'{bad'),key);
   if(scenario==='blocked')await context.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw Error('denied');}}));
   await page.route(base+'/',r=>r.fulfill({contentType:'text/html',body:source}));
   await page.route(endpoint,async r=>{calls++;if(scenario!=='enriching')await new Promise(r=>setTimeout(r,300));return r.fulfill({contentType:'application/json',body:JSON.stringify({...track,enriching:scenario==='enriching',track:{...track.track,artwork:null,appleMusicUrl:'javascript:alert(1)'}})}).catch(()=>{});});
   await page.goto(base+'/');
   if(scenario!=='enriching'){assert.equal(await page.locator('[data-music-status]').textContent(),'Recent listening');assert(!(await page.locator('[data-music]').textContent()).includes('unavailable'));}
   await page.locator('[data-state=playing]').waitFor();assert((await page.locator('[data-music-track]').getAttribute('href')).startsWith('https://music.apple.com/in/search?term='));
   if(scenario==='enriching'){await page.waitForTimeout(5100);assert.equal(calls,3,'Only two early refreshes');}
   report.push({scenario,passed:true});await context.close();
  }
  fs.writeFileSync(path.join(output,'cache-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exit(1);});
