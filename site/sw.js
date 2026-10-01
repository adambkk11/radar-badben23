// Cache sencillo: la app funciona sin conexión con los últimos datos descargados.
const CACHE = 'radar-v4';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'hist.js', 'trabajo.js', 'icon.svg', 'icon-192.png', 'manifest.json'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Meses del histórico: no cambian salvo que cambie su huella (?v=...), así que se sirven desde la copia.
  if (new URL(req.url).pathname.includes('/hist/')) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok) {
        const ruta = new URL(req.url).pathname;
        for (const k of await c.keys()) if (new URL(k.url).pathname === ruta) await c.delete(k);
        await c.put(req, r.clone());
      }
      return r;
    }));
    return;
  }
  // Siempre intenta la red primero (datos y app actualizados); si no hay red, usa la copia.
  e.respondWith(fetch(req).then(r => {
    if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
    return r;
  }).catch(() => caches.match(req, { ignoreSearch: true })));
});
