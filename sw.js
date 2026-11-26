// Clay Bay plays with no internet (22 Nov, docs/plan/family-setup.html). This worker answers every request of the app from
// its cache first, and from the internet only for what isn't there yet. On its first install it keeps the app's code (so
// the app opens with no internet); the page itself (src/engine/offline.ts) then downloads everything else into the same
// cache, and on later opens with the internet brings only the files whose contents changed (precache.json, written by
// the build, lists every file with a short hash of its contents). A new version is used the next time the app opens.
const CACHE = 'claybay-files';
const META = '__meta.json';
// the app's code, its page, its icon and the install file: what it needs to open at all
const SHELL = /^(index\.html|manifest\.webmanifest|icons\/[^/]+|assets\/[^/]+\.(js|css|woff2?|ttf|otf))$/;
const scope = () => new URL(self.registration.scope);
const abs = (rel) => new URL(rel, scope()).href;

async function readMeta(cache) {
  const r = await cache.match(abs(META));
  try { return r ? await r.json() : { files: {} }; } catch { return { files: {} }; }
}
async function writeMeta(cache, meta) {
  await cache.put(abs(META), new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const list = await (await fetch(abs('precache.json'), { cache: 'no-store' })).json();
      const cache = await caches.open(CACHE);
      const meta = await readMeta(cache);
      const shell = list.files.filter((f) => SHELL.test(f.u));
      await Promise.all(shell.map(async (f) => {
        if (meta.files[f.u] === f.h && await cache.match(abs(f.u))) return;
        const r = await fetch(abs(f.u), { cache: 'reload' });
        if (r.ok) { await cache.put(abs(f.u), r); meta.files[f.u] = f.h; }
      }));
      await writeMeta(cache, meta);
    } catch (e) { /* no list (offline, or the development server): the cache fills as the app is used */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url), base = scope();
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return;
  const rel = url.pathname.slice(base.pathname.length);
  if (rel === 'precache.json' || rel === 'sw.js' || rel === META) return;      // always the internet's
  const navigate = req.mode === 'navigate';
  const key = abs(navigate || rel === '' ? 'index.html' : rel);                // (a page's ?screen=... is the same page)
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(key);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic' && !navigate) event.waitUntil(cache.put(key, res.clone()));   // (kept while it plays)
      return res;
    } catch (e) {
      if (navigate) { const page = await cache.match(abs('index.html')); if (page) return page; }
      throw e;
    }
  })());
});
