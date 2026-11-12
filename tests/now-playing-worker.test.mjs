import test from 'node:test';
import assert from 'node:assert/strict';
import { createMusicService, normalizeRecentTracks, safeArtworkUrl, safeTrackUrl, renderSVG, artworkCandidates, albumArtworkCandidates, appleMusicCandidate } from '../workers/now-playing.mjs';

const NOW = Date.parse('2026-11-12T12:00:00Z');
const ART = 'https://lastfm.freetls.fastly.net/i/u/300x300/abc123.jpg';
const ENV = { LASTFM_USERNAME: 'test-listener', LASTFM_API_KEY: 'fixture-not-a-real-key' };
const raw = (changes = {}) => ({ name: 'Fixture track', artist: { '#text': 'Fixture artist' }, album: { '#text': 'Fixture album' }, url: 'https://www.last.fm/music/Fixture/_/Track', image: [{ size: 'large', '#text': ART }], date: { uts: String(NOW / 1000 - 120) }, ...changes });
const payload = track => ({ recenttracks: { track: track === undefined ? [] : [track] } });
const request = (path = '/api/now-playing', options = {}) => new Request('https://music.example.test' + path, options);
function harness(fetchImpl, opts = {}) {
  let time = NOW;
  const entries = new Map();
  const cache = {
    async match(key) { const value = entries.get(String(key)); return value && value.expires > time ? value.response.clone() : undefined; },
    async put(key, response) { entries.set(String(key), { response: response.clone(), expires: time + Number(response.headers.get('cache-control').match(/max-age=(\d+)/)[1]) * 1000 }); },
  };
  const service = createMusicService({ fetchImpl, cache, now: () => time, logger: { warn() {} }, artworkFallback: false, appleMusicLookup: false, ...opts });
  return { fetch: (req = request(), env = ENV, ctx) => service.fetch(req, env, ctx), advance: ms => { time += ms; }, entries };
}
const jsonResponse = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

test('normalizes active playback only from the exact Last.fm attribute', () => {
  const data = normalizeRecentTracks(payload(raw({ '@attr': { nowplaying: 'true' } })), ENV.LASTFM_USERNAME, NOW);
  assert.equal(data.status, 'playing');
  assert.equal(data.track.title, 'Fixture track');
  assert.equal(data.track.artist, 'Fixture artist');
  assert.equal(data.track.album, 'Fixture album');
  assert.equal(data.track.artwork, ART);
  assert.equal(data.track.playedAt, '2026-11-12T11:58:00.000Z');
  assert.equal(normalizeRecentTracks(payload(raw({ '@attr': { nowplaying: true } })), 'x', NOW).status, 'recent');
});
test('last played, empty history, missing metadata and artwork have explicit states', () => {
  assert.equal(normalizeRecentTracks(payload(raw()), 'x', NOW).status, 'recent');
  assert.deepEqual(normalizeRecentTracks(payload(), 'x', NOW).track, null);
  const missing = normalizeRecentTracks(payload({}), 'x', NOW);
  assert.equal(missing.track.title, 'Unknown track');
  assert.equal(missing.track.artist, 'Unknown artist');
  assert.equal(missing.track.album, '');
  assert.equal(missing.track.artwork, null);
  assert.equal(missing.track.playedAt, null);
  assert.equal(normalizeRecentTracks({ recenttracks: { track: raw() } }, 'x', NOW).status, 'recent');
});
test('rejects invalid upstream envelopes and invalid future dates', () => {
  assert.throws(() => normalizeRecentTracks({ error: 6, message: 'bad user' }, 'x', NOW));
  assert.throws(() => normalizeRecentTracks({}, 'x', NOW));
  assert.equal(normalizeRecentTracks(payload(raw({ date: { uts: '9999999999999' } })), 'x', NOW).track.playedAt, null);
});
test('URL allowlists reject arbitrary hosts, credentials, unsafe schemes and redirects', () => {
  for (const url of ['javascript:alert(1)', 'http://127.0.0.1/a.jpg', 'https://lastfm.freetls.fastly.net.evil.test/i/u/300x300/a.jpg', 'https://lastfm.freetls.fastly.net/i/u/300x300/a.svg', 'https://lastfm.freetls.fastly.net/i/u/300x300/a.jpg?x=1', 'https://x:lastfm@lastfm.freetls.fastly.net/i/u/300x300/a.jpg', 'https://lastfm.freetls.fastly.net/private.jpg']) assert.equal(safeArtworkUrl(url), null);
  assert.equal(safeArtworkUrl(ART), ART);
  assert.equal(safeTrackUrl('https://evil.test/music/x'), null);
  assert.equal(safeTrackUrl('javascript:alert(1)'), null);
});
test('shared normalized cache serves JSON and SVG and ignores cache-busting query inputs', async () => {
  let calls = 0;
  const h = harness(async url => {
    calls++;
    const upstream = new URL(url);
    assert.equal(upstream.hostname, 'ws.audioscrobbler.com');
    assert.equal(upstream.searchParams.get('limit'), '1');
    assert.equal(upstream.searchParams.get('user'), ENV.LASTFM_USERNAME);
    return jsonResponse(payload(raw({ image: [] })));
  });
  const json = await h.fetch(request('/api/now-playing?user=intruder&limit=200'));
  assert.equal((await json.json()).track.title, 'Fixture track');
  const svg = await h.fetch(request('/api/now-playing.svg?random=abc'));
  assert.match(await svg.text(), /LAST PLAYED/);
  await h.fetch(request('/api/now-playing?random=def'));
  assert.equal(calls, 1);
  h.advance(61000); await h.fetch(); assert.equal(calls, 2);
});
test('concurrent JSON and SVG requests collapse to one Last.fm call', async () => {
  let calls = 0;
  const h = harness(async () => { calls++; await new Promise(r => setTimeout(r, 10)); return jsonResponse(payload(raw({ image: [] }))); });
  await Promise.all([h.fetch(), h.fetch(request('/api/now-playing.svg')), h.fetch()]);
  assert.equal(calls, 1);
});
test('upstream error is safe, cached briefly, and never leaks credentials', async () => {
  let calls = 0;
  const h = harness(async () => { calls++; throw new Error('fixture-not-a-real-key secret'); });
  const response = await h.fetch();
  const body = await response.text();
  assert.equal(JSON.parse(body).status, 'unavailable');
  assert.doesNotMatch(body, /fixture-not-a-real-key|secret|ws.audioscrobbler/);
  await h.fetch(); assert.equal(calls, 1);
  h.advance(31000); await h.fetch(); assert.equal(calls, 2);
});
test('Last.fm error responses, malformed JSON, large bodies, HTTP failures and timeouts fail safely', async () => {
  const upstreams = [
    async () => jsonResponse({ error: 29, message: 'rate limit exceeded' }),
    async () => new Response('not JSON'),
    async () => new Response('a'.repeat(65537)),
    async () => new Response('down', { status: 503 }),
    async () => new Promise(() => {}),
  ];
  for (const fetchImpl of upstreams) {
    const h = harness(fetchImpl, { timeoutMs: 15 });
    assert.equal((await (await h.fetch()).json()).status, 'unavailable');
  }
});
test('bounded stale fallback preserves last seen playback and expires after seven days', async () => {
  let fail = false;
  const h = harness(async () => { if (fail) throw new Error('down'); return jsonResponse(payload(raw({ '@attr': { nowplaying: 'true' } }))); });
  assert.equal((await (await h.fetch()).json()).status, 'playing');
  h.advance(61000); fail = true;
  const stale = await (await h.fetch()).json();
  assert.equal(stale.status, 'playing'); assert.equal(stale.stale, true);
  const svg = await (await h.fetch(request('/api/now-playing.svg'))).text();
  assert.doesNotMatch(svg, /NOW PLAYING/); assert.match(svg, /CACHED/);
  h.advance(604800000); assert.equal((await (await h.fetch()).json()).status, 'unavailable');
});
test('a cached playing track without scrobble time never masquerades as last played', async () => {
  let fail = false;
  const h = harness(async () => { if (fail) throw new Error('down'); return jsonResponse(payload(raw({ '@attr': { nowplaying: 'true' }, date: undefined }))); });
  await h.fetch(); fail = true; h.advance(61000);
  const saved = await (await h.fetch()).json();
  assert.equal(saved.status, 'playing'); assert.equal(saved.stale, true); assert.equal(saved.track.playedAt, null);
});
test('CORS is exact, supports permitted origins and rejects others without API use', async () => {
  let calls = 0;
  const h = harness(async () => { calls++; return jsonResponse(payload()); });
  const allowed = await h.fetch(request('/api/now-playing', { headers: { Origin: 'https://a4real.org' } }));
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://a4real.org');
  assert.equal(allowed.headers.get('vary'), 'Origin');
  for (const origin of ['https://a4real.org.evil.test', 'null', 'http://a4real.org']) {
    const denied = await h.fetch(request('/api/now-playing', { headers: { Origin: origin } }));
    assert.equal(denied.status, 403); assert.equal(denied.headers.get('access-control-allow-origin'), null);
  }
  const image = await h.fetch(request('/api/now-playing.svg', { headers: { Origin: 'https://github.com' } }));
  assert.equal(image.status, 200);
  assert.equal(calls, 1);
});
test('HEAD, OPTIONS, unsupported methods, missing credentials and unknown paths', async () => {
  let calls = 0;
  const h = harness(async () => { calls++; return jsonResponse(payload()); });
  assert.equal((await h.fetch(request('/unknown'))).status, 404);
  assert.equal((await h.fetch(request('/api/now-playing', { method: 'POST' }))).status, 405);
  assert.equal((await h.fetch(request('/api/now-playing', { method: 'OPTIONS', headers: { Origin: 'https://a4real.org' } }))).status, 204);
  assert.equal(calls, 0);
  assert.equal(await (await h.fetch(request('/api/now-playing', { method: 'HEAD' }))).text(), '');
  const noKey = await (await h.fetch(request(), { LASTFM_USERNAME: 'x' })).json();
  assert.equal(noKey.status, 'unavailable');
  assert.equal((await (await h.fetch(request(), { ...ENV, LASTFM_USERNAME: '../private' })).json()).profileUrl, null);
});
test('SVG escapes malicious metadata, keeps Unicode, truncates long labels and uses no external assets', () => {
  const data = normalizeRecentTracks(payload(raw({ name: '<script>alert("x")</script> & 🎵 日本語 ' + 'long '.repeat(100), artist: { '#text': 'A & B <foreignObject>' }, album: { '#text': 'Album\u0000\u001f\uffff' } })), 'x', NOW);
  const svg = renderSVG(data);
  assert.doesNotMatch(svg, /<script|<foreignObject|javascript:|href="https?:|@font-face|<animate|<style/);
  assert.match(svg, /&lt;script&gt;/); assert.match(svg, /&amp;/); assert.match(svg, /🎵 日本語/);
  assert.match(svg, /<title id="title">/); assert.match(svg, /<desc id="desc">/);
  assert.match(svg, /viewBox="0 0 640 220"/); assert.match(svg, /…/);
  assert.ok(svg.length < 3000);
  assert.doesNotMatch(svg, /[\u0000-\u0008\u000B\u000C\u000E-\u001F\ufffe\uffff]/);
});
test('SVG embeds allowlisted raster artwork as base64 and caches it', async () => {
  let calls = 0;
  const jpeg = new Uint8Array([255,216,255,224,0,0,0,0,0,0,0,0]);
  const h = harness(async (url, options) => {
    calls++;
    assert.equal(options.redirect, 'manual');
    return url.startsWith(API_PREFIX) ? jsonResponse(payload(raw())) : new Response(jpeg, { headers: { 'Content-Type': 'image/jpeg' } });
  });
  const response = await h.fetch(request('/api/now-playing.svg'));
  assert.match(response.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(response.headers.get('content-security-policy'), /img-src data:/);
  const svg = await response.text();
  assert.match(svg, /href="data:image\/jpeg;base64,/); assert.doesNotMatch(svg, /href="https?:/);
  await h.fetch(request('/api/now-playing.svg?foo=bar')); assert.equal(calls, 2);
});
const API_PREFIX = 'https://ws.audioscrobbler.com/';
test('artwork rejects SVG, wrong signatures, oversized content and redirects while retaining track text', async () => {
  const variants = [
    () => new Response('<svg onload="alert(1)"/>', { headers: { 'Content-Type': 'image/svg+xml' } }),
    () => new Response('not an image', { headers: { 'Content-Type': 'image/jpeg' } }),
    () => new Response(new Uint8Array(102401), { headers: { 'Content-Type': 'image/jpeg' } }),
    () => new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1' } }),
  ];
  for (const variant of variants) {
    const h = harness(async url => url.startsWith(API_PREFIX) ? jsonResponse(payload(raw())) : variant());
    const svg = await (await h.fetch(request('/api/now-playing.svg'))).text();
    assert.match(svg, /Fixture track/); assert.doesNotMatch(svg, /<image/);
  }
});


test('diagnostics identify Last.fm error codes without exposing keys, URLs or upstream messages', async () => {
  const records=[];
  const h=harness(async()=>new Response(JSON.stringify({error:10,message:ENV.LASTFM_API_KEY+' private message'}),{status:403,headers:{'Content-Type':'application/json'}}),{logger:{warn:(...args)=>records.push(args)}});
  const response=await h.fetch();
  assert.equal(response.headers.get('x-music-build'),'on-rotation-7');
  assert.equal((await response.json()).status,'unavailable');
  assert.equal(records[0][1].kind,'lastfm_error');
  assert.equal(records[0][1].lastfmCode,10);
  assert.doesNotMatch(JSON.stringify(records),/fixture-not-a-real-key|private message|audioscrobbler/);
});

test('denied-origin diagnostics and response identify the deployed code without exposing configuration', async () => {
  const records=[];
  const h=harness(async()=>jsonResponse(payload()),{logger:{warn:(...args)=>records.push(args)}});
  const response=await h.fetch(request('/api/now-playing',{headers:{Origin:'https://www.a4real.org'}}),{...ENV,PORTFOLIO_ORIGINS:'https://a4real.org'});
  assert.equal(response.status,403);
  assert.equal(response.headers.get('x-music-build'),'on-rotation-7');
  assert.deepEqual(records[0][1],{build:'on-rotation-7',kind:'origin_denied',apexAllowed:true,wwwAllowed:false});
});


test('uses Workers-compatible manual redirects and rejects API redirects without following them', async () => {
  let calls=0;
  const records=[];
  const h=harness(async(url,options)=>{
    calls++;
    if(options.redirect!=='manual')throw new TypeError('Unsupported redirect mode in Workers');
    return new Response(null,{status:302,headers:{Location:'http://127.0.0.1/private'}});
  },{logger:{warn:(...args)=>records.push(args)}});
  assert.equal((await(await h.fetch()).json()).status,'unavailable');
  assert.equal(calls,1);
  assert.equal(records[0][1].kind,'upstream_redirect');
});

const DEEZER_ART = 'https://cdn-images.dzcdn.net/images/cover/0123456789abcdef0123456789abcdef/250x250-000000-80-0-0.jpg';
const OTHER_DEEZER_ART = DEEZER_ART.replace('0123456789abcdef0123456789abcdef','fedcba9876543210fedcba9876543210');
const JPEG = new Uint8Array([255,216,255,224,0,0,0,0,0,0,0,0]);
const coverTrack = (changes={}) => raw({image:[], '@attr':{nowplaying:'true'},...changes});
const catalogTrack = (changes={}) => ({title:'Fixture track',artist:{name:'Fixture artist'},album:{id:123,title:'Fixture album',cover_medium:DEEZER_ART},...changes});
function coverHarness({track=coverTrack(),album={error:6},albumCatalog={data:[]},catalog={data:[]},image=()=>new Response(JPEG,{headers:{'Content-Type':'image/jpeg'}}),extraFetch}={},options={}) {
  const calls=[];
  const h=harness(async(url,init)=>{
    const u=new URL(url);
    assert.equal(init.redirect,'manual');
    if(u.hostname==='ws.audioscrobbler.com'){
      const method=u.searchParams.get('method');calls.push(method);
      if(method==='user.getRecentTracks')return jsonResponse(payload(track));
      assert.equal(method,'album.getInfo');
      return typeof album==='function'?album(url,init):jsonResponse(album);
    }
    if(u.hostname==='api.deezer.com'){
      assert.equal(u.searchParams.get('limit'),'10');
      if(u.pathname==='/search/album'){calls.push('albumCatalog');return typeof albumCatalog==='function'?albumCatalog(url,init):jsonResponse(albumCatalog);}
      calls.push('catalog');
      return typeof catalog==='function'?catalog(url,init):jsonResponse(catalog);
    }
    calls.push('image');
    if(extraFetch)return extraFetch(url,init);
    return image(url,init);
  },{artworkFallback:true,...options});
  return {...h,calls};
}

test('artwork allowlist accepts only fixed Deezer cover paths and rejects known Last.fm placeholders',()=>{
  assert.equal(safeArtworkUrl(DEEZER_ART),DEEZER_ART);
  assert.equal(safeArtworkUrl(DEEZER_ART.replace('cdn-images','e-cdns-images')),DEEZER_ART.replace('cdn-images','e-cdns-images'));
  for(const value of [DEEZER_ART.replace('cdn-images.dzcdn.net','cdn-images.dzcdn.net.evil.test'),DEEZER_ART+'?url=http://127.0.0.1',DEEZER_ART.replace('250x250','1000x1000'),DEEZER_ART.replace('.jpg','.svg'),DEEZER_ART.replace('https:','http:'),DEEZER_ART.replace('https://','https://user:pass@'), 'https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png'])assert.equal(safeArtworkUrl(value),null);
});
test('album lookup enriches missing artwork without replacing Last.fm playback metadata',async()=>{
  const h=coverHarness({album:{album:{name:'Fixture album',artist:'Fixture artist',url:'https://www.last.fm/music/Fixture+artist/Fixture+album',image:[{'#text':ART}]}}});
  const data=await(await h.fetch()).json();
  assert.equal(data.status,'playing');assert.equal(data.track.title,'Fixture track');assert.equal(data.track.album,'Fixture album');
  assert.equal(data.track.artwork,ART);assert.equal(data.track.artworkSource,'lastfm');
  assert.equal(data.track.artworkPage,'https://www.last.fm/music/Fixture+artist/Fixture+album');
  assert.deepEqual(h.calls,['user.getRecentTracks','album.getInfo','image']);
});
test('unrelated album responses are rejected and exact Deezer tracks supply shared JSON/SVG artwork',async()=>{
  const h=coverHarness({album:{album:{name:'Fixture album',artist:'Another artist',image:[{'#text':ART}]}},catalog:{data:[catalogTrack({title:'Fixture track (Live)'}),catalogTrack({artist:{name:'Another artist'}}),catalogTrack()]}});
  const data=await(await h.fetch()).json();
  assert.equal(data.track.artwork,DEEZER_ART);assert.equal(data.track.artworkSource,'deezer');assert.equal(data.track.artworkPage,'https://www.deezer.com/album/123');
  assert.equal(data.track.title,'Fixture track');assert.equal(data.track.artist,'Fixture artist');
  const svg=await(await h.fetch(request('/api/now-playing.svg'))).text();
  assert.match(svg,/data:image\/jpeg;base64,/);assert.match(svg,/Artwork via Deezer/);assert.doesNotMatch(svg,/href="https?:/);
  assert.deepEqual(h.calls,['user.getRecentTracks','album.getInfo','albumCatalog','catalog','image']);
});
test('catalog matching handles Unicode and case, prefers the album, and preserves version qualifiers',()=>{
  const track={title:'Café — 夜',artist:'Beyoncé',album:'An album'};
  const first=catalogTrack({title:'CAFE 夜',artist:{name:'BEYONCE'},album:{id:1,title:'Other compilation',cover_medium:OTHER_DEEZER_ART}});
  const exact=catalogTrack({title:'cafe 夜',artist:{name:'Beyonce'},album:{id:2,title:'AN ALBUM',cover_medium:DEEZER_ART}});
  const result=artworkCandidates({data:[first,exact,catalogTrack({title:'CAFE 夜 (Live)',artist:{name:'BEYONCE'}})]},track);
  assert.equal(result.length,2);assert.equal(result[0].artwork,DEEZER_ART);assert.equal(result[0].artworkPage,'https://www.deezer.com/album/2');
  assert.deepEqual(artworkCandidates({data:[catalogTrack({title:'Song'})]},{title:'Song (Remix)',artist:'Fixture artist',album:''}),[]);
});
test('usable primary artwork avoids catalog work and broken primary images fall back',async()=>{
  const good=coverHarness({track:coverTrack({image:[{'#text':ART}]})});
  assert.equal((await(await good.fetch()).json()).track.artwork,ART);
  good.advance(61000);await good.fetch();
  assert.deepEqual(good.calls,['user.getRecentTracks','image','user.getRecentTracks']);
  const bad=coverHarness({track:coverTrack({image:[{'#text':ART}]}),catalog:{data:[catalogTrack()]},image:url=>url===ART?new Response('not found',{status:404}):new Response(JPEG,{headers:{'Content-Type':'image/jpeg'}})});
  const data=await(await bad.fetch()).json();assert.equal(data.status,'playing');assert.equal(data.track.artwork,DEEZER_ART);
  assert.deepEqual(bad.calls,['user.getRecentTracks','image','album.getInfo','albumCatalog','catalog','image']);
});
test('artwork successes, true misses and transient failures cache separately from playback refreshes',async()=>{
  const found=coverHarness({catalog:{data:[catalogTrack()]}});await found.fetch();found.advance(61000);await found.fetch();
  assert.equal(found.calls.filter(c=>c==='catalog').length,1);assert.equal(found.calls.filter(c=>c==='image').length,1);
  found.advance(86401000);await found.fetch();assert.equal(found.calls.filter(c=>c==='catalog').length,1);assert.equal(found.calls.filter(c=>c==='image').length,2);
  const missing=coverHarness();await missing.fetch();missing.advance(61000);await missing.fetch();assert.equal(missing.calls.filter(c=>c==='catalog').length,1);assert.equal(missing.calls.filter(c=>c==='albumCatalog').length,1);
  missing.advance(3600000);await missing.fetch();assert.equal(missing.calls.filter(c=>c==='catalog').length,2);assert.equal(missing.calls.filter(c=>c==='albumCatalog').length,2);
  const transient=coverHarness({catalog:()=>new Response('down',{status:503})});await transient.fetch();transient.advance(61000);await transient.fetch();assert.equal(transient.calls.filter(c=>c==='catalog').length,1);
  transient.advance(300000);await transient.fetch();assert.equal(transient.calls.filter(c=>c==='catalog').length,2);
});
test('concurrent listeners share a track-artwork lookup without exposing account credentials',async()=>{
  const h=coverHarness({album:async()=>{await new Promise(r=>setTimeout(r,10));return jsonResponse({error:6});},catalog:{data:[catalogTrack()]}});
  const results=await Promise.all([h.fetch(request(),{...ENV,LASTFM_USERNAME:'one'}),h.fetch(request('/api/now-playing.svg'),{...ENV,LASTFM_USERNAME:'two'})]);
  assert.equal(h.calls.filter(c=>c==='album.getInfo').length,1);assert.equal(h.calls.filter(c=>c==='catalog').length,1);assert.equal(h.calls.filter(c=>c==='image').length,1);
  for(const response of results)assert.doesNotMatch(await response.text(),/fixture-not-a-real-key|api_key/);
});
test('unmatched, unsafe, oversized and non-raster artwork never changes the playing state',async()=>{
  const cases=[
    {catalog:{data:[catalogTrack({title:'A different song'})]}},
    {catalog:{data:[catalogTrack({album:{id:1,title:'Fixture album',cover_medium:'https://evil.test/secret.jpg'}})]}},
    {catalog:{data:[catalogTrack()]},image:()=>new Response('<svg/>',{headers:{'Content-Type':'image/svg+xml'}})},
    {catalog:{data:[catalogTrack()]},image:()=>new Response(new Uint8Array(102401),{headers:{'Content-Type':'image/jpeg'}})},
    {catalog:()=>jsonResponse({unexpected:'payload'})},
  ];
  for(const fixture of cases){const h=coverHarness(fixture);const data=await(await h.fetch()).json();assert.equal(data.status,'playing');assert.equal(data.track.title,'Fixture track');assert.equal(data.track.artwork,null);assert.equal(data.track.artworkSource,null);}
});
test('unknown metadata skips optional lookups and provider timeouts fail softly',async()=>{
  const unknown=coverHarness({track:{'@attr':{nowplaying:'true'}}});assert.equal((await(await unknown.fetch()).json()).status,'playing');assert.deepEqual(unknown.calls,['user.getRecentTracks']);
  const timedOut=coverHarness({album:()=>new Promise(()=>{}),catalog:()=>new Promise(()=>{})},{timeoutMs:15});
  const data=await(await timedOut.fetch()).json();assert.equal(data.status,'playing');assert.equal(data.track.artwork,null);
});
test('optional artwork work has a three-second total budget even when every provider hangs',async()=>{
  const started=Date.now();
  const h=coverHarness({track:coverTrack({image:[{'#text':ART}]}),album:()=>new Promise(()=>{}),albumCatalog:()=>new Promise(()=>{}),catalog:()=>new Promise(()=>{}),image:()=>new Promise(()=>{})});
  const data=await(await h.fetch()).json();
  assert.equal(data.status,'playing');assert.equal(data.track.artwork,null);assert.ok(Date.now()-started<3300);
});


test('exact artist and album lookup handles featured-title differences without replacing track metadata',async()=>{
  const track=coverTrack({name:'Pickup (feat. OG Lucifer)',artist:{'#text':'Seedhe Maut'},album:{'#text':'DL91FM'}});
  const h=coverHarness({track,albumCatalog:{data:[
    {id:30,title:'DL91 FM',artist:{name:'Another artist'},cover_medium:OTHER_DEEZER_ART},
    {id:31,title:'DL91 FM Live',artist:{name:'Seedhe Maut'},cover_medium:OTHER_DEEZER_ART},
    {id:32,title:'DL91 FM',artist:{name:'Seedhe Maut'},cover_medium:DEEZER_ART},
  ]}});
  const data=await(await h.fetch()).json();
  assert.equal(data.status,'playing');assert.equal(data.track.title,'Pickup (feat. OG Lucifer)');assert.equal(data.track.album,'DL91FM');
  assert.equal(data.track.artwork,DEEZER_ART);assert.equal(data.track.artworkPage,'https://www.deezer.com/album/32');
  assert.deepEqual(h.calls,['user.getRecentTracks','album.getInfo','albumCatalog','image']);
});
test('album covers require exact artist and album identities and valid source IDs',()=>{
  const track={artist:'Seedhe Maut',album:'DL91 FM',title:'Pickup (feat. OG Lucifer)'};
  const base={id:1,title:'DL91 FM',artist:{name:'Seedhe Maut'},cover_medium:DEEZER_ART};
  for(const invalid of [
    {...base,artist:{name:'Seedhe Maut Tribute'}},
    {...base,title:'DL91 FM Deluxe'},
    {...base,title:'DL91 FM Remixes'},
    {...base,id:'1'},
    {...base,cover_medium:'https://evil.test/cover.jpg'},
    catalogTrack(),
  ])assert.deepEqual(albumArtworkCandidates({data:[invalid]},track),[]);
  assert.equal(albumArtworkCandidates({data:[{...base,title:'dl91fm',artist:{name:'SEEDHE MAUT'}}]},track).length,1);
});
test('missing or unusable album covers fall through to exact track matching',async()=>{
  const h=coverHarness({albumCatalog:{data:[{id:1,title:'Fixture album',artist:{name:'Fixture artist'},cover_medium:OTHER_DEEZER_ART}]},catalog:{data:[catalogTrack()]},image:url=>url===OTHER_DEEZER_ART?new Response('broken',{status:404}):new Response(JPEG,{headers:{'Content-Type':'image/jpeg'}})});
  const data=await(await h.fetch()).json();assert.equal(data.track.artwork,DEEZER_ART);
  assert.deepEqual(h.calls,['user.getRecentTracks','album.getInfo','albumCatalog','image','catalog','image']);
});

const appleItem = (changes = {}) => ({ kind: 'song', trackName: 'Fixture track', artistName: 'Fixture artist', collectionName: 'Fixture album', trackId: 123, collectionId: 456, ...changes });
const fixtureTrack = { title: 'Fixture track', artist: 'Fixture artist', album: 'Fixture album' };
function backgroundContext() {
  const promises = [];
  return { promises, waitUntil(promise) { promises.push(promise); }, async drain() { for (let i = 0; i < promises.length; i++) await promises[i]; } };
}
test('Apple links require exact title and artist, prefer the matching album, and ignore supplied URLs', () => {
  assert.equal(appleMusicCandidate({ results: [appleItem({ collectionName: 'Other', trackId: 1 }), appleItem({ trackViewUrl: 'javascript:alert(1)' })] }, fixtureTrack), 'https://music.apple.com/in/album/456?i=123');
  assert.equal(appleMusicCandidate({ results: [appleItem({ trackName: 'Fixture track (Live)' }), appleItem({ artistName: 'Fixture artist Tribute' })] }, fixtureTrack), null);
  for (const field of ['trackId', 'collectionId']) for (const value of ['123', -1, 0, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, '123<script>']) {
    assert.equal(appleMusicCandidate({ results: [appleItem({ [field]: value })] }, fixtureTrack), null);
  }
  assert.equal(appleMusicCandidate({ results: [appleItem({ kind: 'music-video' })] }, fixtureTrack), null);
});
test('Apple matching preserves remix, live and featured qualifiers', () => {
  for (const suffix of [' (Live)', ' (Remix)', ' (feat. Guest)']) {
    assert.equal(appleMusicCandidate({ results: [appleItem()] }, { ...fixtureTrack, title: fixtureTrack.title + suffix }), null);
    assert.equal(appleMusicCandidate({ results: [appleItem({ trackName: fixtureTrack.title + suffix })] }, { ...fixtureTrack, title: fixtureTrack.title + suffix }), 'https://music.apple.com/in/album/456?i=123');
  }
  assert.equal(appleMusicCandidate({ results: [appleItem({ trackName: 'Ｆixture track' })] }, fixtureTrack), 'https://music.apple.com/in/album/456?i=123');
});
test('Apple catalog metadata is bounded and cached independently of Last.fm snapshots', async () => {
  let appleCalls = 0;
  const h = harness(async url => {
    const parsed = new URL(url);
    if (parsed.hostname === 'itunes.apple.com') {
      appleCalls++;
      assert.equal(parsed.searchParams.get('term'), 'Fixture artist Fixture track');
      for (const [key, value] of Object.entries({ entity: 'song', media: 'music', country: 'in', limit: '10' })) assert.equal(parsed.searchParams.get(key), value);
      return jsonResponse({ results: [appleItem()] });
    }
    return jsonResponse(payload(raw()));
  }, { appleMusicLookup: true });
  const data = await (await h.fetch()).json();
  assert.equal(data.track.appleMusicMatched, true); assert.equal(data.track.appleMusicUrl, 'https://music.apple.com/in/album/456?i=123');
  h.advance(86400000); await h.fetch(); assert.equal(appleCalls, 1);
  h.advance(30 * 86400000); await h.fetch(); assert.equal(appleCalls, 2);
});
test('unmatched and malicious metadata produce an encoded Apple search link, never a Last.fm fallback', async () => {
  const title = '<script>🎵 & " live';
  const h = harness(async url => new URL(url).hostname === 'itunes.apple.com' ? jsonResponse({ results: [appleItem({ trackId: 'javascript:' })] }) : jsonResponse(payload(raw({ name: title }))), { appleMusicLookup: true });
  const data = await (await h.fetch()).json(), link = new URL(data.track.appleMusicUrl);
  assert.equal(data.track.appleMusicMatched, false); assert.equal(link.origin, 'https://music.apple.com');
  assert.equal(link.searchParams.get('term'), 'Fixture artist ' + title);
});
test('Apple no-match caches for one day; upstream failures retry after five minutes', async () => {
  for (const fail of [false, true]) {
    let calls = 0;
    const h = harness(async url => {
      if (new URL(url).hostname === 'itunes.apple.com') { calls++; if (fail) throw new Error('down'); return jsonResponse({ results: [] }); }
      return jsonResponse(payload(raw()));
    }, { appleMusicLookup: true });
    await h.fetch(); h.advance(61000); await h.fetch(); assert.equal(calls, 1);
    h.advance(fail ? 301000 : 86400000); const data = await (await h.fetch()).json();
    assert.equal(calls, 2); assert.equal(data.status, 'recent'); assert.equal(data.track.appleMusicMatched, false);
  }
});
test('production JSON returns core metadata while catalog is blocked, then exposes enriched cache', async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const h = harness(async url => new URL(url).hostname === 'itunes.apple.com' ? blocked : jsonResponse(payload(raw())), { appleMusicLookup: true });
  const ctx = backgroundContext();
  const response = await Promise.race([h.fetch(request(), ENV, ctx), new Promise((_, reject) => setTimeout(() => reject(new Error('Metadata blocked on catalog')), 100))]);
  const initial = await response.json();
  assert.equal(initial.track.title, 'Fixture track'); assert.equal(initial.enriching, true); assert.equal(response.headers.get('cache-control'), 'no-cache');
  release(jsonResponse({ results: [appleItem()] })); await ctx.drain();
  assert.equal(initial.track.appleMusicMatched, false, 'returned snapshot must not mutate in the background');
  const enriched = await (await h.fetch()).json(); assert.equal(enriched.enriching, false); assert.equal(enriched.track.appleMusicMatched, true);
});
test('production JSON does not block on optional artwork verification either', async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const h = harness(async url => new URL(url).hostname === 'lastfm.freetls.fastly.net' ? blocked : jsonResponse(payload(raw())), { artworkFallback: true });
  const ctx = backgroundContext();
  const response = await Promise.race([h.fetch(request(), ENV, ctx), new Promise((_, reject) => setTimeout(() => reject(new Error('Metadata blocked on artwork')), 100))]);
  assert.equal((await response.json()).enriching, true);
  release(new Response(JPEG, { headers: { 'Content-Type': 'image/jpeg' } })); await ctx.drain();
  assert.equal((await (await h.fetch()).json()).track.artwork, ART);
});
test('stale-while-revalidate instantly retains active last-good data on Last.fm failure without inventing a scrobble', async () => {
  let fail = false, release;
  const blocked = new Promise(resolve => { release = resolve; });
  const h = harness(async () => { if (fail) return blocked; return jsonResponse(payload(raw({ '@attr': { nowplaying: 'true' }, date: undefined }))); });
  await h.fetch(); h.advance(61000); fail = true;
  const ctx = backgroundContext();
  const response = await Promise.race([h.fetch(request(), ENV, ctx), new Promise((_, reject) => setTimeout(() => reject(new Error('Stale metadata blocked')), 100))]);
  const stale = await response.json();
  assert.equal(stale.track.title, 'Fixture track'); assert.equal(stale.stale, true); assert.equal(stale.status, 'playing'); assert.equal(stale.track.playedAt, null);
  assert.equal(response.headers.get('cache-control'), 'no-cache');
  release(new Response('down', { status: 503 })); await ctx.drain();
  assert.equal((await (await h.fetch()).json()).track.title, 'Fixture track');
  assert.match(renderSVG(stale), /LAST SEEN · CACHED/); assert.doesNotMatch(renderSVG(stale), /NOW PLAYING/);
});
test('SWR refresh replaces an old snapshot and optional lookup coalesces across listeners', async () => {
  let title = 'Old', appleCalls = 0;
  const h = harness(async url => {
    if (new URL(url).hostname === 'itunes.apple.com') { appleCalls++; await new Promise(resolve => setTimeout(resolve, 10)); return jsonResponse({ results: [appleItem()] }); }
    return jsonResponse(payload(raw({ name: title })));
  }, { appleMusicLookup: true });
  await h.fetch(); title = 'Fixture track'; h.advance(61000);
  const ctx = backgroundContext();
  const first = await (await h.fetch(request(), ENV, ctx)).json(); assert.equal(first.track.title, 'Old');
  await ctx.drain(); assert.equal((await (await h.fetch()).json()).track.title, 'Fixture track');
  assert.equal(appleCalls, 2);
  const other = { ...ENV, LASTFM_USERNAME: 'another-listener' };
  await Promise.all([h.fetch(request(), other), h.fetch(request(), { ...other, LASTFM_USERNAME: 'third-listener' })]);
  assert.equal(appleCalls, 2, 'catalog cache is shared by metadata identity, not listener');
});
test('Apple timeouts fail softly without delaying the production metadata response', async () => {
  const h = harness(async url => new URL(url).hostname === 'itunes.apple.com' ? new Promise(() => {}) : jsonResponse(payload(raw())), { appleMusicLookup: true, timeoutMs: 20 });
  const ctx = backgroundContext();
  const first = await (await h.fetch(request(), ENV, ctx)).json(); assert.equal(first.enriching, true);
  await ctx.drain();
  const settled = await (await h.fetch()).json();
  assert.equal(settled.enriching, false); assert.equal(settled.status, 'recent');
  assert.equal(settled.track.appleMusicMatched, false); assert.match(settled.track.appleMusicUrl, /^https:\/\/music\.apple\.com\/in\/search\?/);
});
test('optional Apple lookups coalesce across concurrent listeners', async () => {
  let calls = 0, release;
  const blocked = new Promise(resolve => { release = resolve; });
  const h = harness(async url => {
    if (new URL(url).hostname === 'itunes.apple.com') { calls++; return blocked; }
    return jsonResponse(payload(raw()));
  }, { appleMusicLookup: true });
  const ctx = backgroundContext();
  await Promise.all([h.fetch(request(), ENV, ctx), h.fetch(request(), { ...ENV, LASTFM_USERNAME: 'other-listener' }, ctx)]);
  assert.equal(calls, 1); release(jsonResponse({ results: [appleItem()] })); await ctx.drain();
});
