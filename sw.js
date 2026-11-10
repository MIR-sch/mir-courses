const CACHE = 'mir-oge-v1';
const ASSETS = ['.', 'index.html', 'css/styles.css', 'js/app.js', 'logo.png', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))));
self.addEventListener('fetch', e => {
  if (e.request.url.includes('cloud-api.yandex.net')) return; // данные Диска не кэшируем
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
