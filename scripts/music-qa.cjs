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
 const {normalizeRecentTracks,createMusicService}=await import('../workers/now-playing.mjs');
 const {lastfmFixture}=await import('../tests/fixtures/music.mjs');
 const output=path.resolve('output/playwright/music');fs.mkdirSync(output,{recursive:true});
 const base='http://127.0.0.1:8012',origin='https://music.example.test';
 const artwork=fs.readFileSync('tests/fixtures/music-art.png');
 let server;
 try{await fetch(base+'/styles.css');}catch{server=spawn('python3',['-m','http.server','8012','--bind','127.0.0.1','--directory','dist'],{stdio:'ignore'});for(let i=0;i<50;i++){try{await fetch(base+'/styles.css');break;}catch{await new Promise(r=>setTimeout(r,100));}}}
 const source=fs.readFileSync('dist/index.html','utf8').replace(/data-endpoint="[^"]*"/,`data-endpoint="${origin}/api/now-playing"`);
 const browser=await playwright.chromium.launch({executablePath:process.env.PORTFOLIO_BROWSER||(fs.existsSync('/opt/helium/chrome')?'/opt/helium/chrome':undefined),headless:true});
 const report=[];
 try{
  for(const [width,height] of [[320,812],[375,812],[414,896],[768,1024],[1024,900],[1440,1000]]){
   const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'});
   let initial;const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.waitForLoadState('load');
   for(const state of ['playing','recent','empty','missing','long','malicious','stale','error','loading','catalog']){

    await page.route(base+'/',route=>route.fulfill({contentType:'text/html',body:source}));
    await page.route(origin+'/api/now-playing',async route=>{
     if(state==='error'){await route.fulfill({status:503,body:'Unavailable'});return;}
     if(state==='loading')await new Promise(r=>setTimeout(r,2000));
     const data=normalizeRecentTracks(lastfmFixture(state==='loading'||state==='catalog'?'recent':['stale','malicious'].includes(state)?'long':state),'fixture-listener');
     if(state==='catalog'){data.track.artwork='https://cdn-images.dzcdn.net/images/cover/e5925065cdb1cefbc3bd75af4a1f1801/250x250-000000-80-0-0.jpg';data.track.artworkSource='deezer';data.track.artworkPage='https://www.deezer.com/album/123';}
     if(state==='stale'){data.status='playing';data.checkedAt=new Date(Date.now()-300000).toISOString();}
     if(state==='malicious'){data.track.url='javascript:alert(1)';data.track.artwork='http://127.0.0.1/private';data.profileUrl='https://evil.test/';}
     await route.fulfill({contentType:'application/json',body:JSON.stringify(data)}).catch(()=>{});
    });
    await page.route('https://cdn-images.dzcdn.net/**',route=>route.fulfill({contentType:'image/png',body:artwork}));
    await page.route('https://lastfm.freetls.fastly.net/**',route=>route.fulfill({contentType:'image/png',body:artwork}));
    for(let attempt=0;;attempt++){try{await page.goto(base+'/');break;}catch(error){if(attempt>=2||!/ERR_ABORTED|interrupted/.test(String(error)))throw error;await page.waitForTimeout(200);}}await page.evaluate(()=>document.fonts.ready);
    assert((await page.locator('body').evaluate(el=>getComputedStyle(el).fontFamily)).includes('IBM Plex Sans'),'Shared styles missing');
    const expected=state==='playing'?'playing':state==='empty'?'empty':state==='error'?'unavailable':state==='loading'?'loading':'recent';
    await page.locator(`[data-music][data-state=${expected}]`).waitFor();
    const image=page.locator('[data-music-art][src]');if(await image.count()){await image.evaluate(img=>img.decode());assert(await image.isVisible(),'Artwork did not become visible');}
    const card=page.locator('.music-card'),box=await card.boundingBox();
    if(!initial)initial=box;assert.equal(box.height,initial.height,`${width} ${state}: layout changed`);
    assert((await page.evaluate(()=>document.documentElement.scrollWidth))<=width);
    if(width<=700)assert(box.y>=(await page.locator('.home-work').boundingBox()).y+(await page.locator('.home-work').boundingBox()).height);
    assert.equal(await page.locator('.music-card script,.music-card a[href^="javascript:"]').count(),0);
    assert.equal(await page.locator('.music-links a').last().evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
    if(state==='catalog'){assert.equal(await page.locator('[data-music-art-link]').getAttribute('href'),'https://www.deezer.com/album/123');assert.equal(await page.locator('[data-music-art-link]').getAttribute('aria-label'),'View artwork source on Deezer');await page.locator('[data-music-art-link]').focus();assert(await page.locator('[data-music-art-link]').evaluate(el=>el===document.activeElement));}
    if(state==='malicious'){assert.equal(await page.locator('[data-music-track]').getAttribute('href'),null);assert.equal(await page.locator('[data-music-art]').getAttribute('src'),null);}
    if(state==='stale')assert(!(await page.locator('[data-music-status]').textContent()).includes('Now playing'));
    const fullPage=[375,768,1440].includes(width)&&['playing','recent','error'].includes(state);
    await (fullPage?page:card).screenshot({path:path.join(output,`${width}-${state}.png`),...(fullPage?{fullPage:true}:{})});
    if(state==='recent'){
     await context.setOffline(true);await page.waitForFunction(()=>document.querySelector('[data-music]').dataset.state==='unavailable');
     await context.setOffline(false);
     const link=page.locator('.music-links a[href="blog-playlist.html"]');await link.focus();
     assert(await link.evaluate(el=>el===document.activeElement));await page.keyboard.press('Enter');await page.waitForURL('**/blog-playlist.html');await page.waitForLoadState('load');
    }
    assert.deepEqual(errors,[]);report.push({width,height,state,overflow:false,layoutStable:true});
   }
   await context.close();
  }
  // Accelerate only the polling interval, keeping browser timers and visibility events real.
  const page=await browser.newPage();let calls=0;
  await page.route(base+'/',route=>route.fulfill({contentType:'text/html',body:source.replace(/data-endpoint="[^"]*"/,'data-endpoint=""')}));
  await page.route(origin+'/api/now-playing',route=>{calls++;return route.fulfill({contentType:'application/json',body:JSON.stringify(normalizeRecentTracks(lastfmFixture('recent'),'fixture-listener'))});});
  await page.goto(base+'/');
  await page.evaluate(async origin=>{const {mountMusic}=await import('/assets/music.js');const card=document.querySelector('[data-music]');card.dataset.endpoint=origin+'/api/now-playing';window.stopMusic=mountMusic(card,{interval:200});},origin);
  await page.locator('[data-state=recent]').waitFor();await page.waitForTimeout(500);assert(calls>=2,'No polling');
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForTimeout(300);const hiddenCalls=calls;await page.waitForTimeout(600);assert.equal(calls,hiddenCalls,'Hidden tab polled');
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));});
  for(let i=0;i<40&&calls===hiddenCalls;i++)await page.waitForTimeout(50);assert(calls>hiddenCalls,'Visible tab did not resume');await page.close();
  const stalePage=await browser.newPage();
  await stalePage.route(base+'/',route=>route.fulfill({contentType:'text/html',body:source}));
  await stalePage.route(origin+'/api/now-playing',route=>{const data=normalizeRecentTracks(lastfmFixture('playing'),'fixture-listener');data.checkedAt=new Date(Date.now()-300000).toISOString();return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});});
  await stalePage.goto(base+'/');await stalePage.locator('[data-state=unavailable]').waitFor();await stalePage.waitForFunction(()=>document.querySelector('[data-music-note]').textContent==='Cached listening data is out of date.');await stalePage.close();
  const svgPage=await browser.newPage({viewport:{width:700,height:300}});
  for(const state of ['playing','recent','empty','missing','long','error']){
   const service=createMusicService({artworkFallback:false,fetchImpl:async url=>String(url).startsWith('https://ws.audioscrobbler.com/')?(state==='error'?new Response('down',{status:503}):Response.json(lastfmFixture(state))):new Response(artwork,{headers:{'Content-Type':'image/png'}})});
   const response=await service.fetch(new Request(origin+'/api/now-playing.svg'),{LASTFM_USERNAME:'fixture-listener',LASTFM_API_KEY:'fixture-only'});
   const svg=await response.text();fs.writeFileSync(path.join(output,`${state}.svg`),svg);
   await svgPage.setContent(svg);const overflow=await svgPage.locator('svg text').evaluateAll(nodes=>nodes.filter(el=>{const r=el.getBBox();return r.x<0||r.x+r.width>638;}).map(el=>el.textContent));assert.deepEqual(overflow,[],'SVG text overflows');
   for(const background of ['#ffffff','#0d1117']){
    await svgPage.setContent(`<body style="margin:0;background:${background};padding:20px"><img alt="Fixture music card" width="640" height="220" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body>`);
    await svgPage.locator('img').evaluate(img=>img.decode());await svgPage.screenshot({path:path.join(output,`svg-${state}-${background==='#ffffff'?'light':'dark'}.png`)});
   }
  }
  await svgPage.close();
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({checks:report,extra:['hidden-tab pause/resume with accelerated interval','real browser offline state','keyboard playlist navigation','reduced motion','6 SVG states on light and dark backgrounds']},null,2));
  console.log(`${report.length} music viewport/state checks and 12 SVG renders passed.`);
 }finally{await browser.close();server?.kill();}
})().catch(error=>{console.error(error);process.exit(1);});
