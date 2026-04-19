const V = 'fb-v8';  // ← 版本號更新，PWA 會自動清除舊快取
const A = [
  './login.html','./add.html','./index.html','./report.html',
  './wallet.html','./settings.html','./css/style.css',
  './js/db.js','./js/firebase.js','./icons/icon.svg',
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
  // HTML 永遠取最新版
  if (e.request.destination === 'document') {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
