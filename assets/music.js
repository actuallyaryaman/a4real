const REFRESH_MS = 60000;

function artworkURL(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return null;
    if (url.hostname === 'lastfm.freetls.fastly.net' && /^\/i\/u\/(?:\d{1,4}x\d{1,4}|\d{1,4}s)\/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp)$/.test(url.pathname)) return url.href;
    if (['cdn-images.dzcdn.net','e-cdns-images.dzcdn.net'].includes(url.hostname) && /^\/images\/cover\/[a-f0-9]{32}\/250x250-000000-80-0-0\.jpg$/.test(url.pathname)) return url.href;
    return null;
  } catch { return null; }
}
function appleURL(track) {
  try {
    const url = new URL(track.appleMusicUrl);
    if (url.protocol === 'https:' && url.hostname === 'music.apple.com' && !url.username && !url.password && !url.port && !url.hash &&
        (/^\/sg\/album\/[1-9]\d{0,15}$/.test(url.pathname) && /^[1-9]\d{0,15}$/.test(url.searchParams.get('i')) && [...url.searchParams.keys()].every(k => k === 'i'))) return {url:url.href,matched:true};
  } catch {}
  return {url:'https://music.apple.com/sg/search?term='+encodeURIComponent(text(track.artist)+' '+text(track.title)),matched:false};
}
const text = (value, fallback = '') => typeof value === 'string' ? Array.from(value).slice(0, 240).join('') || fallback : fallback;

export function mountMusic(card, {fetchImpl = window.fetch.bind(window), interval = REFRESH_MS} = {}) {
  card._stopMusic?.();
  const get = name => card.querySelector(`[data-music-${name}]`);
  let endpoint;
  try {
    endpoint = new URL(card.dataset.endpoint);
    const local = ['127.0.0.1','localhost'].includes(location.hostname) && endpoint.origin === location.origin && endpoint.protocol === 'http:';
    if ((!local && endpoint.protocol !== 'https:') || endpoint.username || endpoint.password || endpoint.pathname !== '/api/now-playing') return;
  } catch { return; }
  card.dataset.musicMounted='true';
  const key='on-rotation:v2:'+endpoint.origin, maxAge=14*86400000;
  const status=get('status'),title=get('track'),fallback=get('fallback'),artist=get('artist'),album=get('album'),note=get('note'),art=get('art'),artLink=get('art-link'),listen=get('listen');
  let timer,controller,lastGood,lastRequest=0,stopped=false,followups=0,identity='';
  function snapshot(data) {
    if (!data || !['playing','recent'].includes(data.status) || !data.track || !Number.isFinite(Date.parse(data.checkedAt))) return null;
    if (Date.now()-Date.parse(data.checkedAt)>maxAge || Date.parse(data.checkedAt)>Date.now()+60000) return null;
    const track={};
    for (const field of ['title','artist','album','playedAt','artwork','artworkSource','appleMusicUrl']) track[field]=text(data.track[field]);
    track.appleMusicMatched=data.track.appleMusicMatched===true;
    return {status:data.status,checkedAt:data.checkedAt,stale:!!data.stale,enriching:!!data.enriching,track};
  }
  function quiet(empty=false) {
    card.dataset.state=empty?'empty':'unavailable'; status.textContent=empty?'Nothing scrobbled yet':'Recent listening';
    title.hidden=true;title.removeAttribute('href');fallback.hidden=false;fallback.textContent=empty?'A quiet moment.':'Between tracks.';
    artist.textContent='Music, across devices.';album.textContent='';note.textContent=empty?'via Last.fm':'Updates will return shortly.';
    art.hidden=true;art.removeAttribute('src');artLink.hidden=true;artLink.removeAttribute('href');listen.hidden=true;
  }
  function render(data,stored=false) {
    const stale=stored || data.stale || Date.now()-Date.parse(data.checkedAt)>180000;
    const playing=data.status==='playing' && !stale, track=data.track;
    card.dataset.state=playing?'playing':'recent';card.dataset.cached=String(!!stale);
    status.textContent=playing?'Now playing':stale && data.status==='playing'?'Last seen':'Last played';
    const name=text(track.title,'Unknown track'), by=text(track.artist,'Unknown artist'), apple=appleURL(track);
    title.hidden=false;fallback.hidden=true;title.textContent=name;title.title=name;title.href=apple.url;
    artist.textContent=by;artist.title=by;album.textContent=text(track.album);album.title=album.textContent;
    for (const link of [title,artLink,listen]) {link.href=apple.url;link.setAttribute('aria-label',`${apple.matched?'Open':'Find'} ${name} by ${by} on Apple Music`);}
    listen.hidden=false;listen.textContent='Apple Music ↗';
    artLink.title=`Cover via ${track.artworkSource==='deezer'?'Deezer':'Last.fm'} · ${apple.matched?'Open':'Find on'} Apple Music`;
    const image=artworkURL(track.artwork);
    if (image && art.getAttribute('src')!==image) {art.hidden=true;artLink.hidden=true;art.src=image;}
    else if (!image) {art.hidden=true;artLink.hidden=true;art.removeAttribute('src');}
    else if (art.complete && art.naturalWidth) {art.hidden=false;artLink.hidden=false;}
    const date=Date.parse(track.playedAt),stamp=Number.isFinite(date)?date:Date.parse(data.checkedAt);
    const minutes=Math.max(0,Math.floor((Date.now()-stamp)/60000));
    const when=minutes<1?'just now':minutes<60?`${minutes} min ago`:new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric'}).format(stamp);
    note.textContent=playing?'via Last.fm':`${stale?'Stored':'Last.fm'} · ${when}`;
  }
  function retain() {if(lastGood)render(lastGood,true);else quiet();}
  const imageLoaded=()=>{if(art.getAttribute('src')){art.hidden=false;artLink.hidden=!artLink.getAttribute('href');}};
  const imageFailed=()=>{art.hidden=true;artLink.hidden=true;};
  art.addEventListener('load',imageLoaded);art.addEventListener('error',imageFailed);
  function schedule(delay=interval) {clearTimeout(timer);if(!stopped&&!document.hidden)timer=setTimeout(update,delay);}
  async function update() {
    if(stopped||document.hidden||controller)return;
    lastRequest=Date.now();const request=new AbortController();controller=request;
    const timeout=setTimeout(()=>request.abort(),8000);let delay=interval;
    try {
      const response=await fetchImpl(endpoint.href,{signal:request.signal,credentials:'omit',referrerPolicy:'no-referrer'});
      if(!response.ok)throw Error('Unavailable');
      const data=await response.json();if(stopped)return;
      if(data.status==='empty') {lastGood=null;try{localStorage.removeItem(key);}catch{}quiet(true);}
      else {
        const value=snapshot(data);if(!value)throw Error('Invalid response');
        // Keep verified optional fields while the same track is being enriched.
        if(value.enriching && lastGood && ['title','artist','album'].every(k=>value.track[k]===lastGood.track[k])) {
          if(!value.track.artwork)for(const field of ['artwork','artworkSource'])value.track[field]=lastGood.track[field];
          if(!value.track.appleMusicMatched && lastGood.track.appleMusicMatched)for(const field of ['appleMusicUrl','appleMusicMatched'])value.track[field]=lastGood.track[field];
        }
        lastGood=value;render(value);
        if(!value.stale)try{localStorage.setItem(key,JSON.stringify(value));}catch{}
        const next=value.track.artist+'\n'+value.track.title;
        if(next!==identity){identity=next;followups=0;}
        if((value.enriching||value.stale)&&followups<2){followups++;delay=2000;}
      }
    } catch {if(!stopped&&!document.hidden)retain();}
    finally {clearTimeout(timeout);controller=null;schedule(delay);}
  }
  function visibility(){clearTimeout(timer);if(document.hidden)controller?.abort();else if(Date.now()-lastRequest>=interval)update();else schedule(interval-(Date.now()-lastRequest));}
  function offline(){controller?.abort();retain();}
  function online(){update();}
  document.addEventListener('visibilitychange',visibility);window.addEventListener('offline',offline);window.addEventListener('online',online);
  try{lastGood=snapshot(JSON.parse(localStorage.getItem(key)));}catch{}
  if(lastGood)render(lastGood,true);
  else {card.dataset.state='loading';status.textContent='Recent listening';note.textContent='Checking Last.fm…';}
  update();
  const stop=()=>{stopped=true;clearTimeout(timer);controller?.abort();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('offline',offline);window.removeEventListener('online',online);art.removeEventListener('load',imageLoaded);art.removeEventListener('error',imageFailed);delete card.dataset.musicMounted;};
  card._stopMusic=stop;return stop;
}
for(const card of document.querySelectorAll('[data-music]'))if(!card.dataset.musicMounted)mountMusic(card);
