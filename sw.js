const V = 'fb-v34';
const A = [
  './login.html','./add.html','./index.html','./report.html',
  './wallet.html','./settings.html','./shopping.html','./private.html','./memo.html',
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
  const url = e.request.url;
  // 外部 API 請求完全不攔截，直接放行
  if (!url.startsWith(self.location.origin)) return;
  // HTML 和 JS 走網路優先
  if (e.request.destination === 'document' ||
      url.endsWith('.js') || url.includes('/js/')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  // CSS、圖片等靜態資源走快取優先
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
