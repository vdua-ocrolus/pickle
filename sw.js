/* Offline support. The app makes no network calls of its own, so caching the
 * files it is built from is enough to run it with no connection at all.
 *
 * IMPORTANT: bump CACHE_VERSION whenever any precached file changes. The fetch
 * handler is cache-first — deliberately, because a weak signal at a court is
 * worse than no signal, and a network-first strategy would stall on it — so a
 * new version only reaches people when this string changes.
 */
const CACHE_VERSION = 'v2';
const CACHE_NAME = 'pickleball-' + CACHE_VERSION;

const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'assets/styles.css',
  'assets/icons/icon.svg',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/apple-touch-icon.png',
  'js/model.js',
  'js/scheduler.js',
  'js/standings.js',
  'js/finals.js',
  'js/snapshots.js',
  'js/demo.js',
  'js/storage.js',
  'js/app.js',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(PRECACHE); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (key) {
          return key === CACHE_NAME ? null : caches.delete(key);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(function (cached) {
      if (cached) return cached;

      return fetch(request).then(function (response) {
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(request, copy); });
        }
        return response;
      }).catch(function () {
        // Offline and not cached: a page request still gets the app shell.
        if (request.mode === 'navigate') return caches.match('index.html');
        return Response.error();
      });
    })
  );
});
