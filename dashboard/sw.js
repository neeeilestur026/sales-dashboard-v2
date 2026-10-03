/* A316 — the scanner's service worker. Registered from scan.html with scope '/scan.html'.
 *
 * Its only job is to let the installed scanner OPEN in a warehouse dead zone: the page shell (HTML,
 * styles, scripts, icon) is served network-first and falls back to the last copy it saw. Nothing
 * else is touched — no Apps Script or Flask call, no POST, no other origin — so data is never served
 * stale and a mutation is never replayed. Counts made offline live in the page's own draft
 * (localStorage) and are sent when the phone is back online. */
const CACHE = 'hx-scan-a316';
const SHELL = ['/scan.html', '/css/styles.css', '/css/scan.css', '/js/theme.js', '/js/api.js', '/js/auth.js',
               '/js/flow-api.js', '/js/scan.js', '/images/scan-icon-192.png', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.indexOf('hx-scan-') === 0 && k !== CACHE)
    .map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || SHELL.indexOf(url.pathname) === -1) return;
  e.respondWith(fetch(req).then((res) => {
    if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(url.pathname, copy)); }
    return res;
  }).catch(() => caches.match(url.pathname)));
});
