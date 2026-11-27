// Offline support: app shell is cached; sermon data is fetched fresh when online.
const CACHE = 'immanuel-v4';
const SHELL = ['./', 'index.html', 'css/style.css', 'js/config.js', 'js/app.js', 'icons/icon.svg', 'icons/icon-192.png', 'manifest.webmanifest', 'data/sermons.json', 'data/youtube.json', 'data/verses.json', 'data/moods.json', 'data/hymns.json', 'data/ai.json', 'data/journeys.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Network first (so new sermons and code show up), fall back to cache when offline.
  // Pages and data are always revalidated with the server (a cheap 304 when unchanged),
  // so a new deploy shows up on the next open instead of after the browser cache expires.
  const fresh = e.request.mode === 'navigate' || url.pathname.endsWith('.json') || url.pathname.endsWith('/');
  e.respondWith(
    // (a navigation Request cannot be copied with new options, so refetch it by URL)
    fetch(fresh ? e.request.url : e.request, fresh ? { cache: 'no-cache', credentials: 'same-origin' } : undefined)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
