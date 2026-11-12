# On rotation

A Last.fm listening note replaces the homepage's After Hours card. The portfolio stays static on GitHub Pages. A standalone Cloudflare Worker supplies public JSON and a matching SVG for the GitHub profile.

The card preserves the original compact cream margin-note placement, coral top rule, and Barlow/Plex typography, with a small square artwork crop. Album artwork leads, followed by track, artist and album. Its reserved image and text areas keep updates from moving the page. There is no simulated progress bar or playback control. The SVG uses system fonts and embedded raster artwork so it does not depend on remote fonts, artwork URLs, scripts or animation when displayed as an image.

## Configure in the browser

1. Obtain a Last.fm API key from https://www.last.fm/api/account/create. This read-only recent-tracks method needs an API key, not your password, shared secret, session key or Apple Music credentials.
2. Open the Cloudflare Dashboard → **Workers & Pages → Create application → Create Worker**. Choose the simple starter/Hello World option if shown, name it (for example `a4real-music`), and create it. No storage products or repository integration are needed.
3. Open the Worker → **Edit code**. Replace the starter code with the complete contents of **`workers/now-playing.mjs`**. The dashboard editor may call its entry file `worker.js`; retain that entry name. Save/deploy the code when ready.
4. Open Worker → **Settings → Variables and Secrets → Add** and configure:

| Name | Type | Value |
| --- | --- | --- |
| `LASTFM_USERNAME` | Text | Your Last.fm username |
| `LASTFM_API_KEY` | **Secret** | Your Last.fm API key |
| `PORTFOLIO_ORIGINS` | Text, optional | `https://a4real.org,https://www.a4real.org` |

The two portfolio origins are defaults; set the optional variable only if you need a different exact HTTPS origin. Do not add trailing slashes. Save/deploy the configuration. Keep the API key out of source, `content.json`, screenshots, shell commands and Git. This setup requires no Wrangler installation.

5. Copy the Worker's public HTTPS `workers.dev` address from its overview. Use its actual deployed address, rather than the dashboard preview URL. No portfolio DNS change is necessary.
6. Open `https://a4real-music.irumeria.workers.dev/api/now-playing`. Expect JSON with `status`, `track`, `profileUrl`, `checkedAt` and `stale`. `playing` comes only from Last.fm's `nowplaying="true"` attribute. Otherwise the newest scrobble is `recent`; an empty history is `empty`. `unavailable` means missing configuration or an upstream failure. Responses never return the API key or upstream errors.
7. Open the same origin with `/api/now-playing.svg`. Expect a 640 × 220 listening card, with artwork when a supported raster image is available. Test both while listening and after scrobbling a track.
8. Set the one public value in **`content.json`**:

```json
"music": {
  "heading": "On rotation",
  "workerUrl": "https://a4real-music.irumeria.workers.dev"
}
```

Use the origin only, with no endpoint path. Run `python3 build.py`, then commit/push when ready. The live JSON CORS policy permits your public portfolio origins; use the fixture preview below for localhost review. With current branch-based Pages publishing, include the generated HTML and assets. If you enable the existing Actions workflow, it can build them for you. An empty `workerUrl` leaves a quiet unavailable state with a working playlists link and makes no music requests.

## GitHub profile

The profile README is maintained separately at https://github.com/actuallyaryaman/actuallyaryaman, not in this portfolio repository. Append this block there, replacing the uppercase Worker placeholder:

```markdown
### on rotation

[![On rotation — listening activity via Last.fm](https://a4real-music.irumeria.workers.dev/api/now-playing.svg)](https://a4real.org/#music-heading)

<sub>Listening activity reported by Last.fm; the image may update with a delay.</sub>
```

A local prepared copy preserving the existing profile text is in `output/github-profile/README.md`; `README.original.md` is its unchanged source. These drafts are excluded from this portfolio's Git history. Nothing has been written to the profile repository.

The SVG is an opaque cream insert, legible on light and dark README backgrounds. Text is escaped, control characters removed, long labels bounded, and complete track metadata retained in the accessible description. Images are embedded from a restricted Last.fm CDN after content-type, signature and size checks. Untrusted or unsupported artwork becomes a geometric placeholder. There are no remote subresources, web fonts, scripts, SVG animation, or `foreignObject` elements.

GitHub proxies README images through Camo. It may retain an earlier image longer than the Worker's cache lifetime; README playback is a cached listening snapshot, not a real-time promise. The endpoint sets a cache lifetime but cannot force Camo to refresh. Do not add random query parameters, schedule README commits, or repeatedly purge Camo.

## Local fixtures and tests

No secrets or live Last.fm account are required:

```bash
python3 build.py
node scripts/music-preview.mjs --fixture=playing --port=8013
```

Open `http://127.0.0.1:8013/` or its `/api/now-playing.svg` endpoint. This explicitly labelled preview uses synthetic metadata and artwork. Stop/restart with `--fixture=recent`, `empty`, `missing`, `long`, `error` or `timeout`. The preview serves built files, so rebuild after edits. No fixture URL or query toggle is wired into the production site or Worker.

```bash
python3 -m unittest discover -s tests
node tests/now-playing-worker.test.mjs
node --check assets/music.js
node --check workers/now-playing.mjs
```

For browser verification using the already installed Playwright/Chromium, start `python3 scripts/serve.py --port 8012`, then run `node scripts/music-qa.cjs`. It captures six responsive widths, state changes, offline behavior, hidden-tab polling, keyboard navigation, reduced motion, and SVG image rendering on light/dark backgrounds. Artifacts are under `output/playwright/music/`. The separate `node scripts/browser-qa.cjs` checks the existing site's full page collection.

## Cache, privacy and operating limits

- The visible portfolio polls every 60 seconds, pauses when hidden and bounds each request to 8 seconds. Track labels distinguish active playback from scrobbled history. Last.fm may report activity late; the widget does not contact Apple Music or claim device-level playback synchronization.
- JSON and SVG share one normalized 60-second edge cache. Request query strings do not alter the upstream user, limit, or cache key. Concurrent requests within an isolate share an in-flight request. Errors have a 30-second cooldown. Artwork has a one-day cache and a five-minute negative cache.
- A previously scrobbled result can survive an upstream failure for up to 15 minutes with a cached label. A stale active result without a scrobble timestamp becomes unavailable. The cache is evictable and local to each Cloudflare datacenter, not a global rate limiter or durable storage. Dashboard editor previews do not exercise the deployed Cache API.
- Each playback cache miss makes one bounded Last.fm recent-tracks call (`limit=1`); optional artwork queries use their own track-level cache. Last.fm playback JSON is limited to 64 KiB with a 4.5-second timeout; optional artwork resolution has a three-second total budget and a maximum 1.2-second timeout per operation. Artwork is limited to 100 KiB. Music links and images use exact HTTPS Last.fm/Deezer destination and raster-path allowlists. Redirects are rejected. The endpoints do not proxy arbitrary URLs or accept arbitrary usernames from callers.
- JSON permits only the configured portfolio origins in browser CORS requests; SVG is public for image embedding. CORS is not authentication: this is intentionally public listening data and can be requested without a browser Origin header. Public fields are just track, artist, album, artwork, artwork provider/source link, music/profile links, scrobble time and last-check state. No listening history collection, analytics or telemetry is added.
- A small personal widget fits the Workers Free model (currently 100,000 requests/day, 10 ms CPU/request). Cache hits still invoke the Worker. Traffic, cache distribution and artwork processing affect usage; actual Cloudflare CPU/runtime behavior needs verification after manual deployment. No paid service or persistent storage is required by this implementation.
- If a Last.fm client stops reporting now-playing or scrobbles, the integration cannot infer playback independently. If Last.fm leaves its active flag stale, it is still an upstream report rather than proof the device is playing. A browser/proxy result older than three minutes is never labelled Now playing by the portfolio.

## Final live check

After your manual deployment, confirm JSON and SVG over the public Worker URL, then test the portfolio's network request from both allowed domains. Confirm the returned CORS header matches the requesting origin, the key never appears in JSON/page source, and unsupported origins receive 403 for JSON. Test the image through GitHub's actual README rendering, including artwork, rather than assuming local image rendering proves Camo compatibility. Reload after a completed scrobble and confirm Last played plus its time. Leave the laptop offline: the Worker continues running independently.

## Primary references

- [Last.fm user.getRecentTracks](https://www.last.fm/api/show/user.getRecentTracks)
- [Cloudflare Dashboard setup](https://developers.cloudflare.com/workers/get-started/dashboard/)
- [Cloudflare dashboard secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Cloudflare Cache API scope and preview limitations](https://developers.cloudflare.com/workers/runtime-apis/cache/)
- [Workers Free limits](https://developers.cloudflare.com/workers/platform/limits/)
- [GitHub Camo and image cache behavior](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-anonymized-urls)

## Diagnose a deployed unavailable response

The current Worker adds `X-Music-Build: on-rotation-5` to JSON/SVG responses, including denied-origin responses. This confirms which source is running. If the dashboard settings look correct but the endpoint still fails, paste the latest `workers/now-playing.mjs` into Edit code and deploy it; the existing secrets remain in Worker settings.

Open the deployed Worker's live logs, request `/api/now-playing`, and inspect a **Music diagnostic** record. The record contains only a fixed failure category, numeric upstream status/error code, or booleans indicating missing configuration/allowed origins. It never logs the API key, upstream URL, raw error message, or listening metadata. Repeated identical diagnostics within the same isolate are limited to once per minute. Allow 60 seconds between checks for the edge cache and diagnostic cooldown to expire.

- `configuration_missing`: check the named production variable/secret bindings.
- `lastfm_error` with `lastfmCode`: compare the numeric code to Last.fm's documented errors (10 invalid API key, 26 suspended key, 29 rate limit).
- `upstream_http`: Last.fm returned an HTTP error without a usable API error object.
- `upstream_timeout`: the upstream request exceeded its time limit.
- `network_or_invalid_response` / `invalid_response`: network or unexpected upstream payload.
- `origin_denied`: `apexAllowed` and `wwwAllowed` show whether that deployed version actually accepted each intended origin, without exposing arbitrary configuration values.

Keep the production API key stored as Secret. Both Text and Secret bindings are readable by Worker code, so changing the type alone does not diagnose an unavailable response.

Workers fetches use `redirect: "manual"` and reject all 3xx responses explicitly. Cloudflare Workers does not implement Fetch's `error` redirect mode; Node-based mocks alone do not establish runtime compatibility. See [the Workers Request API](https://developers.cloudflare.com/workers/runtime-apis/request/#properties).

For a `lastfm_error` with code **17**, Last.fm requires login to access the listening data. Check Last.fm Settings → Privacy → **Hide recent listening information**. A public widget needs that restriction disabled; changing it also makes recent listening visible on Last.fm itself. The integration intentionally does not bypass privacy restrictions or request a user session. See [Last.fm error codes](https://www.last.fm/api/errorcodes) and [Last.fm privacy settings](https://www.last.fm/settings/privacy).

## Artwork fallback

Last.fm remains the only playback source. Artwork now follows this order: a usable cover from recent tracks, a matching Last.fm album lookup, an exact artist/album match in Deezer, then an exact artist/track match in Deezer. Deezer results must match the normalized track title and artist; an album-title match wins when several results match. Live/remix qualifiers are retained during matching. A compilation scrobble may use the cover of the matching song's single or another release if the compilation itself is unavailable. No catalog result changes the scrobbled title, artist, album or playing state.

Artwork resolution is shared by the website and SVG. It has a three-second total budget after the playback request, with bounded individual requests. Every selected image is checked as an allowed raster before being returned. Failed images can fall through to the next source; unknown tracks, unmatched results or provider failures keep the geometric placeholder without taking playback offline. Positive lookups cache for seven days, unmatched searches for one hour, and temporary failures for five minutes. Downloads remain limited to 100 KiB and approved CDN hosts; redirects, SVG content, credentials and arbitrary URLs are rejected.

The only added provider is the public Deezer catalog; no account, key, paid product or dependency is needed. Searches contain track and artist text, not your Last.fm username, API key, listening timestamps or history. Artwork stays on the original 52px square in the same compact card. The cover is a keyboard-accessible link to its source, with an accessible provider label; the SVG credits the provider in its description. `artworkSource` and `artworkPage` identify the chosen provider in normalized JSON.

The iTunes Search API was evaluated but not selected because its documented promotional presentation requirements would introduce store-specific badges. Cover Art Archive was also evaluated; it needs a separate MusicBrainz release match and a redirect-aware archive pipeline. Deezer's plain artist/title search returned a matching single for the current Last.fm track, while a stricter advanced-query form returned no matches, so the implementation uses plain bounded search plus local exact-match filtering.

CoverAtlas was reviewed as an alternative (homepage, public search scripts and Internet Service Terms). No documented public artwork API was found in the reviewed material. Its published terms discuss purchased-license scope and restrict unauthorized redistribution, so this integration does not scrape its HTML or hotlink its assets. The live fallback instead uses the bounded catalog APIs described above.
