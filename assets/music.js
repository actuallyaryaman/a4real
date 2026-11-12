const REFRESH_MS = 60000;

function lastfmURL(value, prefix) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'www.last.fm' && !url.username && !url.password && !url.port && url.pathname.startsWith(prefix) ? url.href : null;
  } catch { return null; }
}
function artworkURL(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return null;
    if (url.hostname === 'lastfm.freetls.fastly.net' && /^\/i\/u\/(?:\d{1,4}x\d{1,4}|\d{1,4}s)\/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp)$/.test(url.pathname)) return url.href;
    if (['cdn-images.dzcdn.net','e-cdns-images.dzcdn.net'].includes(url.hostname) && /^\/images\/cover\/[a-f0-9]{32}\/250x250-000000-80-0-0\.jpg$/.test(url.pathname)) return url.href;
    return null;
  } catch { return null; }
}
function artworkPageURL(value) {
  const lastfm = lastfmURL(value, '/music/') || lastfmURL(value, '/user/');
  if (lastfm) return lastfm;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'www.deezer.com' && !url.username && !url.password && !url.port && !url.search && !url.hash && /^\/album\/[1-9]\d{0,15}$/.test(url.pathname) ? url.href : null;
  } catch { return null; }
}
const text = (value, fallback = '') => typeof value === 'string' ? Array.from(value).slice(0, 240).join('') || fallback : fallback;

export function mountMusic(card, {fetchImpl = window.fetch.bind(window), interval = REFRESH_MS} = {}) {
  const get = name => card.querySelector(`[data-music-${name}]`);
  let endpoint;
  try {
    endpoint = new URL(card.dataset.endpoint);
    const localPreview = ['127.0.0.1','localhost'].includes(location.hostname) && endpoint.origin === location.origin && endpoint.protocol === 'http:';
    if ((!localPreview && endpoint.protocol !== 'https:') || endpoint.username || endpoint.password || endpoint.pathname !== '/api/now-playing') return;
  } catch { return; }
  let timer, controller, lastRequest = 0, stopped = false;
  const status = get('status'), title = get('track'), fallback = get('fallback'), artist = get('artist'), album = get('album'), note = get('note'), art = get('art'), artLink = get('art-link'), profile = get('profile');
  let announced = '';
  function announce(message) { if (announced !== message) { note.textContent = message; announced = message; } }
  function unavailable(message = 'Listening data is taking a break.') {
    card.dataset.state = 'unavailable'; status.textContent = 'Listening unavailable';
    title.hidden = true; title.removeAttribute('href'); fallback.hidden = false;
    fallback.textContent = 'Between tracks.'; artist.textContent = 'Music, across devices.'; album.textContent = '';
    art.hidden = true; art.removeAttribute('src'); artLink.hidden = true; artLink.removeAttribute('href'); announce(message);
  }
  function render(data) {
    if (!data || !['playing','recent','empty','unavailable'].includes(data.status)) throw new Error('Invalid music response');
    const profileURL = lastfmURL(data.profileUrl, '/user/');
    profile.hidden = !profileURL;
    if (profileURL) profile.href = profileURL; else profile.removeAttribute('href');
    if (data.status === 'unavailable') { unavailable(); return; }
    if (data.status === 'empty') {
      unavailable('No listening history on Last.fm yet.'); card.dataset.state = 'empty';
      status.textContent = 'Nothing scrobbled yet'; fallback.textContent = 'A quiet moment.'; return;
    }
    if (!data.track || typeof data.track !== 'object' || !Number.isFinite(Date.parse(data.checkedAt))) throw new Error('Invalid track');
    // An old browser/proxy response must never continue to claim active playback.
    const stale = data.stale || Date.now() - Date.parse(data.checkedAt) > 180000;
    if (stale && data.status === 'playing' && !Number.isFinite(Date.parse(data.track.playedAt))) { unavailable('Cached listening data is out of date.'); return; }
    const playing = data.status === 'playing' && !stale;
    const trackTitle = text(data.track.title,'Unknown track'), trackArtist = text(data.track.artist,'Unknown artist');
    card.dataset.state = playing ? 'playing' : 'recent';
    status.textContent = playing ? 'Now playing' : stale ? 'Recently scrobbled · cached' : 'Last played';
    const trackURL = lastfmURL(data.track.url, '/music/');
    title.hidden = !trackURL; fallback.hidden = !!trackURL;
    title.textContent = trackTitle; title.title = trackTitle;
    if (trackURL) title.href = trackURL; else title.removeAttribute('href');
    fallback.textContent = trackTitle; fallback.title = trackTitle;
    artist.textContent = trackArtist; artist.title = trackArtist;
    album.textContent = text(data.track.album); album.title = album.textContent;
    const imageURL = artworkURL(data.track.artwork);
    const credit = artworkPageURL(data.track.artworkPage) || trackURL || profileURL;
    artLink.hidden = true;
    if (credit) artLink.href = credit; else artLink.removeAttribute('href');
    const provider = data.track.artworkSource === 'deezer' ? 'Deezer' : 'Last.fm';
    artLink.title = `Artwork via ${provider}`;
    artLink.setAttribute('aria-label', `View artwork source on ${provider}`);
    if (imageURL && (art.getAttribute('src') !== imageURL || (art.complete && art.naturalWidth === 0))) { art.hidden = true; art.src = imageURL; }
    else if (!imageURL) { art.hidden = true; art.removeAttribute('src'); }
    else if (art.complete && art.naturalWidth > 0) { art.hidden = false; artLink.hidden = !credit; }
    let message = playing ? 'Reported by Last.fm. Scrobbles may lag.' : 'Listening activity via Last.fm.';
    const date = Date.parse(data.track.playedAt);
    if (!playing && Number.isFinite(date)) message = `${stale ? 'Cached · ' : ''}${new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(date)} · Last.fm`;
    if (stale && !Number.isFinite(date)) message = 'Cached activity. Last.fm may be unavailable.';
    announce(message);
  }
  const imageLoaded = () => { art.hidden = false; artLink.hidden = !artLink.getAttribute('href'); };
  const imageFailed = () => { art.hidden = true; artLink.hidden = true; };
  art.addEventListener('load', imageLoaded);
  art.addEventListener('error', imageFailed);
  function schedule() { clearTimeout(timer); if (!stopped && !document.hidden) timer = setTimeout(update, interval); }
  async function update() {
    if (stopped || document.hidden || controller) return;
    lastRequest = Date.now(); controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 8000);
    try {
      const response = await fetchImpl(endpoint.href,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});
      if (!response.ok) throw new Error('Music unavailable');
      render(await response.json());
    } catch { unavailable(navigator.onLine === false ? 'Offline. Listening updates will return.' : undefined); }
    finally {clearTimeout(timeout);controller = null;schedule();}
  }
  function visibility() {
    clearTimeout(timer);
    if (document.hidden) controller?.abort();
    else if (Date.now()-lastRequest>=interval) update();
    else timer=setTimeout(update,interval-(Date.now()-lastRequest));
  }
  function offline() { controller?.abort(); unavailable('Offline. Listening updates will return.'); }
  function online() { if (Date.now()-lastRequest>=interval) update(); else schedule(); }
  document.addEventListener('visibilitychange',visibility);
  window.addEventListener('offline',offline);window.addEventListener('online',online);
  card.dataset.state='loading';status.textContent='Checking Last.fm';announce('Finding the latest listening activity.');
  update();
  return () => {stopped=true;clearTimeout(timer);controller?.abort();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('offline',offline);window.removeEventListener('online',online);art.removeEventListener('load',imageLoaded);art.removeEventListener('error',imageFailed);};
}

for (const card of document.querySelectorAll('[data-music]')) mountMusic(card);
