const BUILD = 'on-rotation-5';
class LookupFailure extends Error {
  constructor(kind, details = {}) { super(kind); this.kind = kind; this.details = details; }
}
const API = 'https://ws.audioscrobbler.com/2.0/';
const ART_HOST = 'lastfm.freetls.fastly.net';
const DEFAULT_ORIGINS = ['https://a4real.org', 'https://www.a4real.org'];
const FRESH_SECONDS = 60;
const STALE_SECONDS = 900;
const ERROR_SECONDS = 30;

function clean(value, limit = 240) {
  const text = typeof value === 'string' ? value : '';
  return Array.from(text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uD800-\uDFFF\uFFFE\uFFFF]/gu, '').trim()).slice(0, limit).join('');
}
function label(value) { return clean(typeof value === 'object' && value ? value['#text'] : value); }
export function safeTrackUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'www.last.fm' && !url.username && !url.password && !url.port && url.pathname.startsWith('/music/') ? url.href : null;
  } catch { return null; }
}
export function safeArtworkUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return null;
    if (url.hostname === ART_HOST) {
      if (url.pathname.includes('2a96cbd8b46e442fc41c2b86b821562f')) return null;
      return /^\/i\/u\/(?:\d{1,4}x\d{1,4}|\d{1,4}s)\/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp)$/.test(url.pathname) ? url.href : null;
    }
    if (['cdn-images.dzcdn.net', 'e-cdns-images.dzcdn.net'].includes(url.hostname)) {
      return /^\/images\/cover\/[a-f0-9]{32}\/250x250-000000-80-0-0\.jpg$/.test(url.pathname) ? url.href : null;
    }
    return null;
  } catch { return null; }
}
function lastfmArtwork(value) {
  const safe = safeArtworkUrl(value);
  return safe && new URL(safe).hostname === ART_HOST ? safe : null;
}
function matchingLabel(value) {
  return clean(value).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
export function artworkCandidates(payload, track) {
  if (!Array.isArray(payload?.data)) return [];
  const title = matchingLabel(track.title), artist = matchingLabel(track.artist), album = matchingLabel(track.album);
  return payload.data.slice(0, 10).filter(item =>
    matchingLabel(item?.title) === title && matchingLabel(item?.artist?.name) === artist &&
    Number.isSafeInteger(item?.album?.id) && item.album.id > 0 && safeArtworkUrl(item.album.cover_medium) &&
    new URL(item.album.cover_medium).hostname !== ART_HOST
  ).sort((a, b) => Number(matchingLabel(b.album.title) === album) - Number(matchingLabel(a.album.title) === album))
    .slice(0, 3).map(item => ({ artwork: safeArtworkUrl(item.album.cover_medium), artworkSource: 'deezer', artworkPage: `https://www.deezer.com/album/${item.album.id}` }));
}
function matchingAlbum(value) { return matchingLabel(value).replace(/\s+/g, ''); }
export function albumArtworkCandidates(payload, track) {
  if (!Array.isArray(payload?.data) || !matchingAlbum(track.album)) return [];
  const artist = matchingLabel(track.artist), album = matchingAlbum(track.album);
  return payload.data.slice(0, 10).filter(item =>
    matchingAlbum(item?.title) === album && matchingLabel(item?.artist?.name) === artist &&
    Number.isSafeInteger(item?.id) && item.id > 0 && safeArtworkUrl(item.cover_medium) &&
    new URL(item.cover_medium).hostname !== ART_HOST
  ).slice(0, 3).map(item => ({ artwork: safeArtworkUrl(item.cover_medium), artworkSource: 'deezer', artworkPage: `https://www.deezer.com/album/${item.id}` }));
}
function profile(username) { return `https://www.last.fm/user/${encodeURIComponent(username)}`; }
function unavailable(username, now) {
  return { status: 'unavailable', track: null, profileUrl: username ? profile(username) : null, checkedAt: new Date(now).toISOString(), stale: false };
}
export function normalizeRecentTracks(payload, username, now = Date.now()) {
  if (!payload || payload.error || !payload.recenttracks || !Object.hasOwn(payload.recenttracks, 'track')) throw new Error('Invalid upstream response');
  const rows = payload.recenttracks.track;
  const raw = Array.isArray(rows) ? rows[0] : rows;
  const base = { status: 'empty', track: null, profileUrl: profile(username), checkedAt: new Date(now).toISOString(), stale: false };
  if (!raw || (Array.isArray(rows) && !rows.length)) return base;
  if (typeof raw !== 'object') throw new Error('Invalid track');
  const timestamp = Number(raw.date?.uts);
  const playedAt = Number.isSafeInteger(timestamp) && timestamp > 0 && timestamp * 1000 <= now + 60000 ? new Date(timestamp * 1000).toISOString() : null;
  const artwork = (Array.isArray(raw.image) ? [...raw.image].reverse() : []).map(item => lastfmArtwork(item?.['#text'])).find(Boolean) || null;
  return {
    ...base,
    status: raw['@attr']?.nowplaying === 'true' ? 'playing' : 'recent',
    track: { title: label(raw.name) || 'Unknown track', artist: label(raw.artist) || 'Unknown artist', album: label(raw.album), url: safeTrackUrl(raw.url), artwork, artworkSource: artwork ? 'lastfm' : null, artworkPage: artwork ? safeTrackUrl(raw.url) || profile(username) : null, playedAt },
  };
}
function xml(value) { return clean(value, 1000).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c])); }
function width(char) { return /[\u0000-\u007f]/.test(char) ? (/[MW@]/.test(char) ? 0.9 : 0.6) : 1; }
function truncate(text, max) {
  let result = '', used = 0;
  for (const char of Array.from(text)) { if (used + width(char) > max) return result.trimEnd() + '…'; result += char; used += width(char); }
  return result;
}
function titleLines(text) {
  const chars = Array.from(text), lines = []; let line = '', used = 0;
  while (chars.length && lines.length < 2) {
    const char = chars.shift();
    if (used + width(char) > 15) { lines.push(line.trim()); line = ''; used = 0; }
    if (lines.length === 2) { lines[1] = truncate(lines[1], 14).replace(/…?$/, '…'); return lines; }
    line += char; used += width(char);
  }
  if (line) lines.push(line.trim());
  return lines;
}
export function renderSVG(data, artwork = null) {
  const active = data.status === 'playing' && !data.stale;
  const state = active ? 'NOW PLAYING' : data.status === 'recent' ? (data.stale ? 'RECENTLY SCROBBLED · CACHED' : 'LAST PLAYED') : data.status === 'empty' ? 'NOTHING SCROBBLED YET' : 'LISTENING UNAVAILABLE';
  const title = data.track?.title || (data.status === 'empty' ? 'A quiet moment.' : 'Between tracks.');
  const artist = data.track?.artist || 'Music, via Last.fm';
  const desc = `${state}. ${data.track ? `${title} by ${artist}${data.track.album ? `, from ${data.track.album}` : ''}.` : 'No listening data available.'} Last.fm reports listening activity; scrobbles may be delayed.${data.track?.artworkSource === 'deezer' ? ' Artwork via Deezer.' : ''}`;
  const lines = titleLines(title);
  const image = artwork && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(artwork) ? `<image x="28" y="62" width="120" height="120" preserveAspectRatio="xMidYMid slice" href="${artwork}"/>` : '<rect x="28" y="62" width="120" height="120" fill="#ddd2bb"/><path d="M47 143V103h14v40m14 15V87h14v71m14-29v-16h14v16" fill="#24645b"/><path d="M28 62h120v120H28z" fill="none" stroke="#b3a991"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="220" viewBox="0 0 640 220" role="img" aria-labelledby="title desc"><title id="title">${xml(`On rotation — ${title}`)}</title><desc id="desc">${xml(desc)}</desc><rect width="640" height="220" fill="#e9dfc8"/><path d="M0 2h640" stroke="#f68b69" stroke-width="4"/><g font-family="Arial, Helvetica, sans-serif" fill="#29251f"><text x="28" y="34" font-size="12" font-weight="700" letter-spacing="2">ON ROTATION</text><circle cx="181" cy="68" r="3" fill="${active ? '#24645b' : '#625c50'}"/><text x="194" y="72" font-size="11" letter-spacing="1.1" fill="${active ? '#24645b' : '#625c50'}">${state}</text>${lines.map((line, i) => `<text x="178" y="${109 + i * 32}" font-size="28" font-weight="700">${xml(line)}</text>`).join('')}<text x="178" y="166" font-size="16">${xml(truncate(artist, 25))}</text><text x="178" y="189" font-size="12" fill="#625c50">${xml(truncate(data.track?.album || 'Scrobbled across devices · Last.fm', 34))}</text></g>${image}<path d="M28 205h584" stroke="#b3a991"/></svg>`;
}
async function boundedBody(response, limit) {
  const length = Number(response.headers.get('content-length'));
  if (length > limit) { await response.body?.cancel(); throw new Error('Response too large'); }
  if (!response.body) throw new Error('Missing response body');
  const reader = response.body.getReader(), chunks = []; let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > limit) throw new Error('Response too large');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const all = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
  return all;
}
function rasterType(bytes) {
  if (bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return view.getUint32(16) <= 2048 && view.getUint32(20) <= 2048 ? 'image/png' : null;
  }
  if (bytes.length >= 12 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255) return 'image/jpeg';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0,4))==='RIFF' && String.fromCharCode(...bytes.slice(8,12))==='WEBP') return 'image/webp';
  return null;
}
function base64(bytes) { let value = ''; for (const byte of bytes) value += String.fromCharCode(byte); return btoa(value); }
export function createMusicService({ fetchImpl = (...args) => fetch(...args), cache = null, now = () => Date.now(), timeoutMs = 4500, logger = console, artworkFallback = true } = {}) {
  const inflight = new Map();
  let lastDiagnostic = '', lastDiagnosticAt = 0;
  function diagnostic(kind, details = {}) {
    const record = { build: BUILD, kind, ...details };
    const signature = JSON.stringify(record);
    if (signature !== lastDiagnostic || now() - lastDiagnosticAt >= 60000) {
      lastDiagnostic = signature; lastDiagnosticAt = now();
      try { logger.warn('Music diagnostic', record); } catch { /* Diagnostics never block responses. */ }
    }
  }
  async function timed(url, limit, accept, timeout = timeoutMs, readErrorBody = false) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetchImpl(url, { signal: controller.signal, redirect: 'manual', headers: { Accept: accept } });
          if (response.status >= 300 && response.status < 400) throw new LookupFailure('upstream_redirect');
          if ((!response.ok || response.status >= 300) && !readErrorBody) throw new LookupFailure('upstream_http', { status: response.status });
          return { status: response.status, ok: response.ok, bytes: await boundedBody(response, limit), type: response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() };
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new LookupFailure('upstream_timeout')); }, timeout); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  const activeCache = () => cache || globalThis.caches?.default;
  async function match(key) { try { return await activeCache()?.match(key); } catch { return null; } }
  async function put(key, value, ttl) {
    try { await activeCache()?.put(key, new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}` } })); } catch { /* Cache eviction must not prevent a response. */ }
  }
  async function dataFor(request, env) {
    const username = /^[A-Za-z0-9_-]{1,64}$/.test(env.LASTFM_USERNAME || '') ? env.LASTFM_USERNAME : '';
    if (!username || !env.LASTFM_API_KEY) { diagnostic('configuration_missing', { usernameReady: !!username, apiKeyReady: !!env.LASTFM_API_KEY }); return unavailable(username, now()); }
    const base = `${new URL(request.url).origin}/__music-cache/${BUILD}/${encodeURIComponent(username)}`;
    const cached = await match(base);
    if (cached) return cached.json();
    if (inflight.has(base)) return inflight.get(base);
    const promise = (async () => {
      try {
        const url = new URL(API);
        url.search = new URLSearchParams({ method: 'user.getRecentTracks', user: username, api_key: env.LASTFM_API_KEY, format: 'json', limit: '1' });
        const result = await timed(url.href, 65536, 'application/json', timeoutMs, true);
        let payload;
        try { payload = JSON.parse(new TextDecoder().decode(result.bytes)); }
        catch { throw new LookupFailure(result.ok ? 'invalid_response' : 'upstream_http', result.ok ? {} : { status: result.status }); }
        if (payload?.error) {
          const code = Number(payload.error);
          throw new LookupFailure('lastfm_error', { lastfmCode: Number.isInteger(code) && code > 0 && code < 1000 ? code : null });
        }
        if (!result.ok) throw new LookupFailure('upstream_http', { status: result.status });
        const data = normalizeRecentTracks(payload, username, now());
        if (artworkFallback && data.track) {
          try { Object.assign(data.track, await resolveArtwork(request, data.track, env, data.profileUrl)); }
          catch { Object.assign(data.track, { artwork: null, artworkSource: null, artworkPage: null }); }
        }
        await put(base + '/stale', data, STALE_SECONDS);
        await put(base, data, FRESH_SECONDS);
        return data;
      } catch (error) {
        diagnostic(error instanceof LookupFailure ? error.kind : 'network_or_invalid_response', error instanceof LookupFailure ? error.details : {});
        let data = unavailable(username, now());
        try {
          const previous = await (await match(base + '/stale'))?.json();
          if (previous && now() - Date.parse(previous.checkedAt) < STALE_SECONDS * 1000 && now() >= Date.parse(previous.checkedAt)) {
            if (previous.track?.playedAt) data = { ...previous, status: 'recent', stale: true };
            else if (previous.status === 'recent') data = { ...previous, stale: true };
          }
        } catch { /* An invalid cached value is treated as unavailable. */ }
        await put(base, data, ERROR_SECONDS);
        return data;
      }
    })();
    inflight.set(base, promise);
    try { return await promise; } finally { inflight.delete(base); }
  }
  async function artworkFor(request, value, operationTimeout = 2500) {
    const url = safeArtworkUrl(value); if (!url) return null;
    const key = `${new URL(request.url).origin}/__music-art/${BUILD}/${encodeURIComponent(url)}`;
    const cached = await match(key); if (cached) return (await cached.json()).image;
    if (inflight.has(key)) return inflight.get(key);
    const promise = (async () => {
      try {
        const result = await timed(url, 102400, 'image/jpeg,image/png,image/webp', Math.min(timeoutMs, operationTimeout, 2500));
        const type = rasterType(result.bytes);
        if (!type || type !== result.type) throw new Error('Invalid artwork');
        const image = `data:${type};base64,${base64(result.bytes)}`;
        await put(key, { image }, 86400);
        return image;
      } catch { await put(key, { image: null }, 300); return null; }
    })();
    inflight.set(key, promise);
    try { return await promise; } finally { inflight.delete(key); }
  }
  async function resolveArtwork(request, track, env, profileUrl) {
    const deadline = Date.now() + 3000;
    const remaining = () => Math.max(0, Math.min(timeoutMs, 1200, deadline - Date.now()));
    const empty = { artwork: null, artworkSource: null, artworkPage: null };
    const usable = async value => remaining() > 0 && !!(await artworkFor(request, value, remaining()));
    let transient = false;
    const primary = lastfmArtwork(track.artwork);
    if (primary && await usable(primary)) return { artwork: primary, artworkSource: 'lastfm', artworkPage: safeTrackUrl(track.url) || profileUrl };
    if (primary) transient = true;
    if (!matchingLabel(track.title) || !matchingLabel(track.artist) || track.title === 'Unknown track' || track.artist === 'Unknown artist') return empty;
    const identity = [track.artist, track.title, track.album].map(matchingLabel);
    const key = `${new URL(request.url).origin}/__music-cover-lookup/${BUILD}/${encodeURIComponent(JSON.stringify(identity))}`;
    try {
      const cached = await (await match(key))?.json();
      if (cached) {
        if (!cached.artwork) return empty;
        if (safeArtworkUrl(cached.artwork) && await usable(cached.artwork)) return cached;
        transient = true;
      }
    } catch { transient = true; }
    if (inflight.has(key)) return inflight.get(key);
    const promise = (async () => {
      async function metadata(url) {
        const budget = remaining(); if (!budget) throw new Error('Artwork budget exhausted');
        const result = await timed(url, 65536, 'application/json', budget);
        return JSON.parse(new TextDecoder().decode(result.bytes));
      }
      if (track.album && remaining()) {
        try {
          const url = new URL(API);
          url.search = new URLSearchParams({ method: 'album.getInfo', artist: track.artist, album: track.album, api_key: env.LASTFM_API_KEY, format: 'json', autocorrect: '1' });
          const info = await metadata(url.href);
          if (info.error && ![6, 7].includes(Number(info.error))) transient = true;
          if (matchingLabel(label(info.album?.artist)) === identity[0] && matchingLabel(label(info.album?.name)) === identity[2]) {
            const images = (Array.isArray(info.album?.image) ? [...info.album.image].reverse() : []).map(item => lastfmArtwork(item?.['#text'])).filter(Boolean);
            for (const candidate of [...new Set(images)].slice(0, 2)) {
              if (await usable(candidate)) {
                const cover = { artwork: candidate, artworkSource: 'lastfm', artworkPage: safeTrackUrl(info.album.url) || safeTrackUrl(track.url) || profileUrl };
                await put(key, cover, 604800); return cover;
              }
              transient = true;
            }
          }
        } catch { transient = true; }
      }
      if (track.album && remaining()) {
        try {
          const url = new URL('https://api.deezer.com/search/album');
          // Separate a joined catalogue suffix such as DL91FM without relaxing artist matching.
          const albumQuery = track.album.replace(/(\d)([A-Za-z])/g, '$1 $2');
          url.search = new URLSearchParams({ q: `${track.artist} ${albumQuery}`, limit: '10' });
          const catalog = await metadata(url.href);
          if (!Array.isArray(catalog?.data)) throw new Error('Invalid artwork catalog');
          for (const candidate of albumArtworkCandidates(catalog, track)) {
            if (await usable(candidate.artwork)) { await put(key, candidate, 604800); return candidate; }
            transient = true;
          }
        } catch { transient = true; }
      }
      if (remaining()) {
        try {
          const url = new URL('https://api.deezer.com/search');
          url.search = new URLSearchParams({ q: `${track.artist} ${track.title}`, limit: '10' });
          const catalog = await metadata(url.href);
          if (!Array.isArray(catalog?.data)) throw new Error('Invalid artwork catalog');
          for (const candidate of artworkCandidates(catalog, track)) {
            if (await usable(candidate.artwork)) { await put(key, candidate, 604800); return candidate; }
            transient = true;
          }
        } catch { transient = true; }
      }
      await put(key, empty, transient ? 300 : 3600);
      return empty;
    })();
    inflight.set(key, promise);
    try { return await promise; } finally { inflight.delete(key); }
  }
  return {
    async fetch(request, env = {}) {
      const url = new URL(request.url), svg = url.pathname === '/api/now-playing.svg';
      if (!svg && url.pathname !== '/api/now-playing') return new Response('Not found', { status: 404 });
      const origin = request.headers.get('Origin');
      const allowed = (env.PORTFOLIO_ORIGINS || DEFAULT_ORIGINS.join(',')).split(',').map(value => value.trim()).filter(value => { try { return new URL(value).origin === value && value.startsWith('https://'); } catch { return false; } });
      const headers = new Headers({ 'X-Music-Build': BUILD, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=60', 'Content-Type': svg ? 'image/svg+xml; charset=utf-8' : 'application/json; charset=utf-8' });
      if (svg) headers.set('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'none'; sandbox");
      else {
        headers.set('Vary', 'Origin');
        if (origin && !allowed.includes(origin)) { diagnostic('origin_denied', { apexAllowed: allowed.includes(DEFAULT_ORIGINS[0]), wwwAllowed: allowed.includes(DEFAULT_ORIGINS[1]) }); return new Response('{"error":"Origin not allowed"}', { status: 403, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Music-Build': BUILD, 'Vary': 'Origin' } }); }
        if (origin) headers.set('Access-Control-Allow-Origin', origin);
      }
      if (request.method === 'OPTIONS') {
        headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        headers.set('Access-Control-Max-Age', '86400');
        return new Response(null, { status: 204, headers });
      }
      if (!['GET', 'HEAD'].includes(request.method)) { headers.set('Allow', 'GET, HEAD, OPTIONS'); return new Response(null, { status: 405, headers }); }
      const data = await dataFor(request, env);
      if (data.status === 'unavailable' || data.stale) headers.set('Cache-Control', 'public, max-age=30');
      const image = svg && request.method !== 'HEAD' ? await artworkFor(request, data.track?.artwork) : null;
      return new Response(request.method === 'HEAD' ? null : svg ? renderSVG(data, image) : JSON.stringify(data), { headers });
    },
  };
}
const service = createMusicService();
export default { fetch(request, env, ctx) { return service.fetch(request, env, ctx); } };
