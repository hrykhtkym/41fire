const CACHE = 'shop-scan-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './catalog.json',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => k !== CACHE ? caches.delete(k) : Promise.resolve())))
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // ネットワーク優先、失敗時にキャッシュ
  event.respondWith(
    fetch(req).then(res => {
      const resClone = res.clone();
      caches.open(CACHE).then(cache => cache.put(req, resClone)).catch(()=>{});
      return res;
    }).catch(() => caches.match(req))
  );
});

