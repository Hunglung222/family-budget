// 每次改版只需要改這個版本號
const V = 'fb-v6';
const A = [
  './login.html','./add.html','./index.html','./report.html',
  './wallet.html','./settings.html','./css/style.css',
  './js/db.js','./js/firebase.js','./icons/icon.svg',
];

self.addEventListener('install', e => {
  // 立即接管，不等舊 SW 結束
  self.skipWaiting();
  e.waitUntil(
    caches.open(V).then(c => c.addAll(A).catch(() => {}))
  );
});

self.addEventListener('activate', e => {
  // 刪除所有舊版快取
  e.waitUntil(
    caches.keys().then(ks =>
      Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())  // 立即接管所有頁面
  );
});

self.addEventListener('fetch', e => {
  // HTML 檔案：永遠從網路抓最新版，失敗才用快取
  if (e.request.destination === 'document') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }
  // 其他檔案：有快取用快取，沒有才抓網路
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
