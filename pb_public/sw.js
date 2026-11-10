/* Notas · Service Worker — cache-first para el código, nunca para los datos.
   Calcado de tareas (la explicación larga vive allí):
   · `?v=N` (js/css) → del disco, sin red: la URL es inmutable.
   · navegación (`/`) → responde del disco y revalida detrás; si el HTML
     cambió de `?v`, precarga el shell nuevo y avisa (UPDATE_READY).
   · /api/, /search, /mcp → directo a red, jamás en caché.
   `CACHE` solo se toca si cambia la ESTRUCTURA de la caché. */
const CACHE = 'notas-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

function shellUrlsFrom(html) {
  const out = [];
  const re = /(?:src|href)\s*=\s*["'](\/[^"']+\.(?:js|css)(?:\?v=\d+)?)["']/gi;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}
const verOf = html => { const m = /\?v=(\d+)/.exec(html); return m ? m[1] : null; };

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL).catch(() => {});
    try { const res = await c.match('/'); if (res) await c.addAll(shellUrlsFrom(await res.text())); } catch (_) {}
  })());
});
self.addEventListener('message', e => { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
async function notifyClients(msg) { (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).forEach(c => c.postMessage(msg)); }
async function purgeOldVersions(c, ver) {
  if (!ver) return;
  const keys = await c.keys();
  await Promise.all(keys.map(req => { const v = new URL(req.url).searchParams.get('v'); return v && v !== ver ? c.delete(req) : null; }));
}
async function handleNavigate(e) {
  const c = await caches.open(CACHE);
  const cached = await c.match('/');
  const oldP = cached ? cached.clone().text().catch(() => null) : Promise.resolve(null);
  const fresh = fetch('/', { cache: 'no-store' }).then(async res => {
    if (!res || !res.ok) return res;
    const html = await res.clone().text();
    const old = await oldP;
    await c.put('/', res.clone());
    if (old !== null && old !== html) {
      try { await c.addAll(shellUrlsFrom(html)); } catch (_) {}
      await purgeOldVersions(c, verOf(html));
      await notifyClients({ type: 'UPDATE_READY' });
    }
    return res;
  }).catch(() => null);
  if (cached) { e.waitUntil(fresh); return cached; }
  return (await fresh) || fetch(e.request);
}
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  /* /shared/<token> es la página pública de solo lectura, no la app. */
  if (/^\/(api|search|mcp|shared|_)(\/|$)/.test(url.pathname)) return;
  if (e.request.mode === 'navigate') { e.respondWith(handleNavigate(e)); return; }
  if (url.searchParams.has('v')) {
    e.respondWith(caches.match(e.request).then(m => m || fetch(e.request).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {}); return res; })));
    return;
  }
  e.respondWith(caches.match(e.request).then(m => {
    const net = fetch(e.request).then(res => { if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {}); } return res; }).catch(() => m || caches.match('/'));
    if (m) { e.waitUntil(net.catch(() => {})); return m; }
    return net;
  }));
});
