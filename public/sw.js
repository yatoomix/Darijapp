/* DerjApp — service worker — coquille applicative en cache, données toujours au réseau.
   La progression vit dans localStorage, donc l'app est pleinement utilisable hors ligne. */
const CACHE = 'derjapp-v1.6.1';
const SHELL = ['/', '/index.html', '/app.js', '/seed-data.js',
               '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // jamais de cache sur Supabase ni sur le CDN de la lib : on veut des données fraîches
  if (url.origin !== self.location.origin) return;

  // réseau d'abord, cache en secours — pour ne pas servir une vieille version après déploiement
  e.respondWith(
    fetch(e.request)
      .then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('/index.html')))
  );
});
