const V = 'fb-v2026.06.25-0605';
const A = [
  './login.html','./index.html','./add.html','./report.html',
  './invest.html','./wallet.html','./shopping.html','./settings.html',
  './trade.html','./knowledge.html','./invest-guide.html',
  './private.html','./memo.html','./guide.html',
  './grow.html',
  './advisor.html',
  './css/style.css',
  './js/auth.js','./js/db.js',
  './js/inbox.js','./js/chat.js','./js/firebase.js','./js/assistant.js','./js/tw_stocks.js','./js/badges.js','./js/garden.js','./js/pet.js','./js/advisor.js',
  './icons/icon-192.png','./icons/icon-512.png',
];
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(V).then(c =>
    // 逐檔加入快取，失敗的檔案會印出來方便除錯（不讓單一檔案失敗害整個安裝失敗）
    Promise.all(A.map(url =>
      c.add(url).catch(err => console.warn('[SW] 預快取失敗:', url, err && err.message))
    ))
  ));
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
  if (!url.startsWith(self.location.origin)) return;
  // HTML、JS → 網路優先（確保更新即時生效）
  if (e.request.destination === 'document' ||
      url.endsWith('.js') || url.includes('/js/')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  // CSS、圖片等靜態資源 → 快取優先
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
