// Local fixtures only. No credentials or external requests.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createMusicService} from '../workers/now-playing.mjs';
import {lastfmFixture,states} from '../tests/fixtures/music.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixture=process.argv.find(a=>a.startsWith('--fixture='))?.split('=')[1]||'playing';
const port=Number(process.argv.find(a=>a.startsWith('--port='))?.split('=')[1]||8013);
if(!states.includes(fixture)||!Number.isInteger(port)||port<1024||port>65535)throw new Error('Use --fixture='+states.join('|')+' and --port=8013');
const mime={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.pdf':'application/pdf'};
const cache=new Map();
const service=createMusicService({artworkFallback:false,
  timeoutMs:200,
  cache:{async match(k){const v=cache.get(k);return v&&v.expiry>Date.now()?v.response.clone():undefined;},async put(k,r){cache.set(k,{response:r.clone(),expiry:Date.now()+60000});}},
  fetchImpl:async url=>{
    if(!String(url).startsWith('https://ws.audioscrobbler.com/'))return new Response(await fs.readFile(path.join(root,'tests/fixtures/music-art.png')),{headers:{'Content-Type':'image/png'}});
    if(fixture==='error')return new Response('Unavailable',{status:503});
    if(fixture==='timeout')return new Promise(()=>{});
    return Response.json(lastfmFixture(fixture));
  }
});
http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,`http://127.0.0.1:${port}`);
    if(url.pathname.startsWith('/api/')){
      const reply=await service.fetch(new Request(url,{method:req.method}),{LASTFM_USERNAME:'fixture-listener',LASTFM_API_KEY:'fixture-only'});
      res.writeHead(reply.status,Object.fromEntries(reply.headers));res.end(Buffer.from(await reply.arrayBuffer()));return;
    }
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
    const name=decodeURIComponent(url.pathname)==='/'?'index.html':decodeURIComponent(url.pathname).slice(1);
    const target=path.resolve(root,'dist',name);
    if(!target.startsWith(path.join(root,'dist')+path.sep)){res.writeHead(404);res.end();return;}
    let body=await fs.readFile(target);
    if(name==='index.html')body=Buffer.from(body.toString().replace(/data-endpoint="[^"]*"/,`data-endpoint="${url.origin}/api/now-playing"`).replace('<main id="main"','<p style="text-align:center;font-size:12px;padding:8px">LOCAL FIXTURE · '+fixture+' · not actual listening activity</p><main id="main"'));
    res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:body);
  }catch{res.writeHead(404);res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log(`Local ${fixture} fixture: http://127.0.0.1:${port} (not actual listening activity)`));
