/* Service worker: gemmer hele appen til offline brug. Genereres af build – rediger assets/sw.js. */
'use strict';
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const SCOPE = self.registration.scope; // fx https://eksempel.dk/om-teknik/
const PREFIX = 'mdpwa:' + new URL(SCOPE).pathname + ':';
const CACHE = PREFIX + VERSION;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache: 'reload' går uden om browserens HTTP-cache, så vi får den nye version.
    await cache.addAll(PRECACHE.map((p) => new Request(new URL(p, SCOPE), { cache: 'reload' })));
  })());
  // Første installation aktiveres straks. Opdateringer venter, til brugeren vælger "Genindlæs".
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'GET_VERSION' && event.source) event.source.postMessage({ type: 'VERSION', version: VERSION });
});

function normalize(url) {
  const u = new URL(url);
  u.search = '';
  u.hash = '';
  if (u.pathname.endsWith('/index.html')) u.pathname = u.pathname.slice(0, -10);
  return u.href;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith(SCOPE)) return;
  const isNav = req.mode === 'navigate';

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = isNav ? normalize(req.url) : req.url;
    let hit = await cache.match(key, { ignoreSearch: isNav });
    if (!hit && isNav && !key.endsWith('/')) hit = await cache.match(key + '/');
    if (hit) return hit;
    try {
      const res = await fetch(req);
      // Ting der ikke var forhåndsgemt (fx JPEG-fallback), gemmes når de hentes.
      if (res.ok && !isNav && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (err) {
      // Offline: brug den forhåndsgemte (mindste) udgave af et billede.
      const m = req.url.match(/\/media\/(.+)-\d+\.(webp|jpg)$/);
      if (m) {
        const alt = PRECACHE.find((p) => p.startsWith('media/' + m[1] + '-') && p.endsWith('.webp'));
        const hitAlt = alt && await cache.match(new URL(alt, SCOPE).href);
        if (hitAlt) return hitAlt;
      }
      if (isNav) {
        return new Response(
          '<!doctype html><html lang="da"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
          + '<title>Ingen forbindelse</title><main style="font-family:system-ui;padding:1rem;max-width:40rem">'
          + '<h1>Siden findes ikke offline</h1><p>Du er uden internet, og denne side er ikke gemt i appen.</p>'
          + '<p><a href="' + SCOPE + '">Gå til forsiden</a></p></main></html>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
      throw err;
    }
  })());
});
