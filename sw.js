// 오프라인용: 앱 파일을 캐시에 두고, 온라인일 때 뒤에서 새 버전을 받아 둔다.
const CACHE = 'tango-v8';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'vendor/ts-fsrs.umd.js', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-512.png', 'library/index.json', 'library/jp1000.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    return hit || (await net) || cache.match('index.html');
  }));
});
