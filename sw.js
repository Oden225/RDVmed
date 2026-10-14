/* RDVmed — Service Worker
   Cache hors-ligne + réception des notifications push (rappels de rendez-vous,
   envoyés par la fonction Supabase, même application fermée). */

const CACHE = 'rdvmed-v8';
const CORE = [
  './', './index.html', './manifest.webmanifest',
  './config.js', './push-client.js', './logo-mark.svg',
  './icon-192.png', './icon-512.png'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  // Ne jamais mettre en cache les appels à Supabase.
  if (request.url.includes('/rest/v1/')) return;
  e.respondWith(
    caches.match(request).then((hit) => hit || fetch(request).catch(() => hit))
  );
});

/* --- PUSH : rappel de rendez-vous --- */
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) { data = { body: e.data && e.data.text() }; }
  const title = data.title || 'RDVmed — rappel';
  e.waitUntil(self.registration.showNotification(title, {
    body: data.body || 'Un rendez-vous approche.',
    icon: data.icon || './icon-192.png',
    badge: data.badge || './icon-192.png',
    tag: data.tag || 'rdvmed-reminder',
    renotify: true,
    data: { url: data.url || './', id: data.id || null },
    vibrate: [80, 40, 80]
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
