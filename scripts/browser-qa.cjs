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
(async () => {
  let server;
  try { await fetch('http://127.0.0.1:8000/index.html'); }
  catch {
    server=spawn('python3',['-m','http.server','8000','--bind','127.0.0.1','--directory','dist'],{stdio:'ignore'});
    let ready=false;
    for(let i=0;i<50;i++) {try {await fetch('http://127.0.0.1:8000/index.html');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
    if(!ready){server.kill();throw new Error('Local QA server did not start');}
  }

  const output = path.resolve('output/playwright/chromium'); fs.mkdirSync(output, { recursive: true });
  const executablePath = process.env.PORTFOLIO_BROWSER || (fs.existsSync('/opt/helium/chrome') ? '/opt/helium/chrome' : undefined);
  const browser = await playwright.chromium.launch({ executablePath, headless: true });
  const report = [];
  try {
    for (const [width, height] of [[320,812],[375,812],[414,896],[768,1024],[1024,900],[1440,1000]]) {
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      for (const file of JSON.parse(fs.readFileSync('build-manifest.json', 'utf8')).pages) {
        const response = await page.goto(`http://127.0.0.1:8000/${file}`);
        if (!response.ok()) throw new Error(`${file}: HTTP ${response.status()}`);
        await page.evaluate(() => document.fonts.ready);
        if(await page.locator('.site-footer .footer-contact').count()!==1 || await page.locator('a[href="mailto:mail@a4real.org"]').count()<1)throw new Error('Missing consistent contact footer');
        const removed=await page.evaluate(()=>({cloudsec:/cloudsec/i.test(document.body.innerText),ataraxia:/ataraxia/i.test(document.body.innerText),linkedinPage:!!document.querySelector('a[href="linkedin.html"],.linkedin-collection'),oldTrace:!!document.querySelector('a[href*="trace2.a4real.org"]')}));
        if(Object.values(removed).some(Boolean)) throw new Error(file+': retired content remains '+JSON.stringify(removed));

        if (!(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches))) throw new Error('Reduced-motion preference unavailable');
        const shared = await page.evaluate(() => {
          const style = selector => {const s=getComputedStyle(document.querySelector(selector)); return {font:s.fontFamily,color:s.color,size:s.fontSize}};
          return {brand:style('.author-mark'),navigation:style('.masthead nav a'),footer:style('footer'),activeColour:getComputedStyle(document.querySelector('.masthead nav [aria-current]')).textDecorationColor};
        });
        const baseline=report.find(r=>r.viewport===`${width}x${height}`);
        if (baseline && JSON.stringify(shared)!==JSON.stringify(baseline.shared)) throw new Error('Shared chrome drifts: '+file);

        const measurements = await page.evaluate(() => ({
          width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
          headingCount: document.querySelectorAll('h1').length,
          overflow: [...document.querySelectorAll('main *, nav *')].filter(el => {
            const r=el.getBoundingClientRect(); return !el.closest('svg') && r.width && (r.right>innerWidth+1 || r.left< -1);
          }).map(el => `${el.tagName}.${el.className}`)
        }));
        if (measurements.scrollWidth > width || measurements.overflow.length || measurements.headingCount !== 1)
          throw new Error(`${width} ${file}: ${JSON.stringify(measurements)}`);
        if (file === 'index.html') {
          for(const href of ['https://trace.a4real.org/','https://zk.a4real.org/']) if(!(await page.locator(`.work-copy a[href="${href}"]`).count()))throw new Error('Missing direct homepage demo: '+href);
          const order=await page.evaluate(()=>({work:document.querySelector('.home-work').getBoundingClientRect().bottom,note:document.querySelector('.music-card').getBoundingClientRect().top}));
          if(width<=700 && order.note<order.work)throw new Error('Music precedes work on mobile');
        }
        if (file === 'projects.html') {
          const bodySize=await page.locator('.case-trace .project-prose').evaluate(e=>getComputedStyle(e).fontSize);
          if(bodySize!==(width<=700?'16px':'17px'))throw new Error('Flagship reading size: '+bodySize);
          for (const href of ['https://zk.a4real.org/','https://trace.a4real.org/','https://github.com/actuallyaryaman/the-hidden-colouring','https://github.com/ay03/SE6014-Agentic-Threat-Hunting']) {
            if (!(await page.locator(`main a[href="${href}"]`).count())) throw new Error('Missing project link: '+href);
          }
        }
        for (const image of await page.locator('main img[src]:visible').all()) {
          await image.scrollIntoViewIfNeeded();
          await image.evaluate(img => img.decode());
        }
        await page.evaluate(() => scrollTo(0,0));
        await page.screenshot({ path: path.join(output, `${width}-${file.replace('.html','')}.png`), fullPage: true });
        for (const summary of await page.locator('summary').all()) {
          await summary.click();
          if (!(await summary.evaluate(el => el.parentElement.open))) throw new Error('Disclosure failed to open');
          await summary.press('Enter');
          if (await summary.evaluate(el => el.parentElement.open)) throw new Error('Disclosure failed to close');
        }
        const current = page.locator('nav a[aria-current="page"]');
        if (await current.count() !== 1) throw new Error('Missing active page navigation');
        for (const href of ['index.html','projects.html','blog.html','resume.html','about.html']) {
          await page.waitForLoadState('load');
          await page.evaluate(()=>document.fonts.ready);
          const destination=page.locator(`.masthead nav a[href="${href}"]`);
          await destination.focus();await destination.press('Enter');
          await page.waitForURL(url=>url.pathname.endsWith('/'+href),{waitUntil:'load'});
          if (!page.url().endsWith(href)) throw new Error(`Navigation failed: ${href}`);
        }
        await page.goto(`http://127.0.0.1:8000/${file}`);
        await page.keyboard.press('Tab');
        if (!(await page.locator('.skip').evaluate(el => el === document.activeElement))) throw new Error('Skip link not first in focus order');
        await Promise.all([page.waitForURL(url=>url.hash==='#main'),page.keyboard.press('Enter')]);
        if (!page.url().endsWith('#main')) throw new Error(`${width} ${file}: skip link failed`);
        if (!(await page.locator('#main').evaluate(el=>el===document.activeElement))) throw new Error('Skip link did not transfer focus');
        const paperLink=page.locator('.music-card a:visible,.case-scope a').first();
        if (await paperLink.count()) {
          await paperLink.focus();
          const focus=await paperLink.evaluate(el=>({visible:el.matches(':focus-visible'),outline:getComputedStyle(el).outlineStyle,width:getComputedStyle(el).outlineWidth,colour:getComputedStyle(el).outlineColor,expected:getComputedStyle(el.closest('.music-card,.case-scope')).color}));
          if (!focus.visible||focus.outline==='none'||focus.width==='0px') throw new Error('Missing paper-panel focus outline');
          if (focus.colour!==focus.expected) throw new Error('Focus colour does not match paper ink');
          if ([375,1440].includes(width)) await page.locator(file==='index.html'?'.music-card':'.case-scope').screenshot({path:path.join(output,`${width}-${file.replace('.html','')}-paper-focus.png`)});
          await paperLink.hover();
        }


        await Promise.all([page.waitForURL(url=>url.hash==='#top'),page.locator('footer a[href="#top"]').click()]);
        if (!page.url().endsWith('#top')) throw new Error(`${width} ${file}: back-to-top failed`);
        if (errors.length) throw new Error(errors.join('\n'));
        report.push({ viewport: `${width}x${height}`, page: file, measurements, shared, errors });
        fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
      }
      await page.close();
    }
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
    console.log(`Completed ${report.length} page/viewport checks. Screenshots in output/playwright/chromium/.`);
  } finally { await browser.close(); if(server)server.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
