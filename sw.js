const V = 'fb-v5';
const A = [
  './','./add.html','./index.html','./report.html','./wallet.html','./settings.html',
  './css/style.css','./js/db.js','./js/firebase.js','./icons/icon.svg',
  'https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js',
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(A).catch(() => {})));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).catch(() => r))
  );
});
