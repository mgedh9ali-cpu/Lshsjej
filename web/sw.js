const version = 'qum-public-v1';
const assets = [
  '/offline.html', '/styles.css', '/app.js', '/common.js', '/manifest.webmanifest',
  '/icon-192.png', '/icon-512.png', '/icon-maskable.svg', '/fonts/cairo-arabic.woff2', '/fonts/cairo-latin.woff2',
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(version).then(cache => cache.addAll(assets)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('qum-public-') && key !== version).map(key => caches.delete(key)),
  )));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')));
    return;
  }
  if (!assets.includes(url.pathname) || url.search) return;
  event.respondWith(fetch(event.request).then(response => {
    if (!response.ok) return response;
    const copy = response.clone();
    return caches.open(version).then(cache => cache.put(event.request, copy)).catch(() => {}).then(() => response);
  }).catch(() => caches.match(event.request)));
});
