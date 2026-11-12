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
 const http=require('node:http');const {normalizeRecentTracks}=await import('../workers/now-playing.mjs');const {lastfmFixture}=await import('../tests/fixtures/music.mjs');
 const base='http://127.0.0.1:8015',key='on-rotation:v2:'+base,output='output/playwright/music/obscura';fs.mkdirSync(output,{recursive:true});
 let mode='playing',pending,finish,calls=0;
 const liveFile=process.env.MUSIC_QA_LIVE_JSON;const live=liveFile?JSON.parse(fs.readFileSync(liveFile,'utf8')):null;
 const payload=()=>{if(mode==='live')return live;const data=normalizeRecentTracks(lastfmFixture(['error','slow','enriching'].includes(mode)?'playing':mode),'fixture-listener');if(data.track){data.track.artwork=null;data.track.appleMusicUrl='https://music.apple.com/in/album/123?i=456';data.track.appleMusicMatched=true;}if(mode==='enriching')data.enriching=true;return data;};
 const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.woff2':'font/woff2','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.pdf':'application/pdf'};
 const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,base);
  if(url.pathname==='/api/now-playing'){calls++;if(mode==='slow')await pending;if(mode==='error'){res.writeHead(503);res.end('Unavailable');return;}res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(payload()));return;}
  const file=path.resolve('dist',url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).slice(1));if(!file.startsWith(path.resolve('dist')+path.sep))throw Error();
  let body=fs.readFileSync(file);if(file.endsWith('index.html'))body=Buffer.from(body.toString().replace(/data-endpoint="[^"]*"/,`data-endpoint="${base}/api/now-playing"`).replace('<main id="main"','<p style="text-align:center;font-size:12px">LOCAL QA FIXTURE · synthetic listening data</p><main id="main"'));
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(body);
 }catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(8015,'127.0.0.1',r));
 const browser=await playwright.chromium.connectOverCDP(process.env.PORTFOLIO_CDP||'ws://127.0.0.1:9237/devtools/browser'),report=[];
 try{
  for(const width of [375,768,1440]){
   const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'}),page=await context.newPage();
   let height;
   for(const state of ['playing','recent','missing','long','empty']){
    mode=state;await page.goto(base+'/');await page.evaluate(key=>localStorage.removeItem(key),key);await page.reload();
    await page.waitForFunction(state=>document.querySelector('[data-music]').dataset.state===(state==='playing'?'playing':state==='empty'?'empty':'recent'),state);
    const card=page.locator('[data-music]'),box=await card.boundingBox();if(height)assert.equal(box.height,height,`${width}/${state}: height changed`);else height=box.height;
    assert((await page.evaluate(()=>document.documentElement.scrollWidth))<=width,`${width}: overflow`);
    assert.equal(await page.locator('.music-card a[href*="last.fm"]').count(),0);
    if(state!=='empty'){
     assert.equal(await page.locator('[data-music-track]').getAttribute('href'),'https://music.apple.com/in/album/123?i=456');
     assert.equal(await page.locator('[data-music-art-link]').getAttribute('href'),'https://music.apple.com/in/album/123?i=456');
     await page.locator('[data-music-track]').focus();assert(await page.locator('[data-music-track]').evaluate(e=>e===document.activeElement));
    }
    await page.screenshot({path:`${output}/${width}-${state}.png`,fullPage:true});await card.screenshot({path:`${output}/card-${width}-${state}.png`});
    report.push({width,state,layoutStable:true,overflow:false,appleLinks:state!=='empty'});
   }
   // Cached active metadata paints before an intentionally blocked fresh request.
   mode='playing';await page.reload();await page.locator('[data-state=playing]').waitFor();
   mode='slow';pending=new Promise(r=>finish=r);await page.reload({waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>document.querySelector('[data-music-status]').textContent==='Last seen');
   assert.equal(await page.locator('[data-music-track]').textContent(),'The long way home');finish();
   await page.locator('[data-state=playing]').waitFor();mode='error';await page.reload();
   await page.waitForFunction(()=>document.querySelector('[data-music]').dataset.cached==='true');assert.equal(await page.locator('[data-music-track]').textContent(),'The long way home');
   const playlists=page.locator('.music-links a[href="blog-playlist.html"]');await playlists.focus();assert(await playlists.evaluate(el=>el===document.activeElement));await playlists.click();await page.waitForURL('**/blog-playlist.html',{waitUntil:'domcontentloaded'});
   report.push({width,storedBeforeResponse:true,retainedOnError:true,keyboardFocus:true,playlistClickNavigation:true});
   if(live?.track){mode='live';await page.goto(base+'/');await page.waitForFunction(name=>document.querySelector('[data-music-track]').textContent===name,live.track.title);const art=page.locator('[data-music-art]');await art.evaluate(img=>img.decode());assert(await art.isVisible());await page.screenshot({path:`${output}/${width}-live.png`,fullPage:true});await page.locator('[data-music]').screenshot({path:`${output}/card-${width}-live.png`});report.push({width,liveArtworkDecoded:true});}
   await context.close();
  }
  fs.writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1)});
