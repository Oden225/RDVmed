const CACHE='rdvmed-v1';
const FICHIERS=['.','index.html','manifest.webmanifest','icon-192.png','icon-512.png'];
self.addEventListener('install',e=>{ e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FICHIERS))); self.skipWaiting(); });
self.addEventListener('activate',e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch',e=>{
  if(e.request.url.includes('supabase')) return; // sync toujours en direct
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});
