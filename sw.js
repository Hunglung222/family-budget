const V = 'fb-v21';
const A = [
  './login.html','./add.html','./index.html','./report.html',
  './wallet.html','./settings.html','./shopping.html',
  './css/style.css','./js/db.js','./js/firebase.js',
  './icons/icon-192.png','./icons/icon-512.png',
];
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(V).then(c => c.addAll(A).catch(() => {})));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  if (e.request.destination === 'document') {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
