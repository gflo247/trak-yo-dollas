const CACHE_VERSION = '__CACHE_VERSION__';
const CACHE_NAME = `trakyo-${CACHE_VERSION}`;

// Use canonical clean URLs — Cloudflare 307-redirects *.html to these.
// Precaching the .html variants would store a redirect response, not the page.
const PRECACHE = [
  '/',
  '/trakyodollas',
  '/privacy',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/fonts/fonts.css',
  '/fonts/dm-sans.woff2',
  '/fonts/dm-sans-ext.woff2',
  '/fonts/dm-sans-italic.woff2',
  '/fonts/dm-sans-italic-ext.woff2',
  '/fonts/dm-mono-400.woff2',
  '/fonts/dm-mono-400-ext.woff2',
  '/fonts/dm-mono-500.woff2',
  '/fonts/dm-mono-500-ext.woff2',
];

// Cloudflare 307s .html → clean URL. Map so the SW can serve from cache
// without following a redirect that may not resolve correctly mid-fetch.
const HTML_CLEAN_URL = {
  '/index.html':       '/',
  '/trakyodollas.html':'/trakyodollas',
  '/privacy.html':     '/privacy',
};

const OFFLINE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>trak-yo-dolla$</title><style>*{box-sizing:border-box;margin:0;padding:0}body{background:#111720;color:#D1DCE8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:2rem}.card{text-align:center;max-width:360px}.logo{font-size:1.1rem;font-weight:800;letter-spacing:-.01em;color:#D1DCE8;margin-bottom:2rem}.logo span{color:#FBBF24}h1{font-size:1.2rem;font-weight:700;margin-bottom:.5rem}p{font-size:.875rem;color:#94A3B8;line-height:1.6;margin-bottom:1.5rem}button{background:rgba(251,191,36,.12);border:1px solid rgba(251,191,36,.4);color:rgba(251,191,36,1);font-family:inherit;font-size:.875rem;font-weight:600;padding:.6rem 1.5rem;border-radius:8px;cursor:pointer}</style></head><body><div class="card"><div class="logo">trak-yo-dolla<span>$</span></div><h1>Temporarily unavailable</h1><p>The site is having a brief hiccup — your data is safe and saved locally. Usually resolves in a minute or two.</p><button onclick="location.reload()">Try again</button></div></body></html>`;

self.addEventListener('install', e => {
  // skipWaiting at the END of the chain so activation (and old-cache deletion)
  // only happens after the precache attempt — prevents an empty-cache window.
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(PRECACHE))
      .catch(() => {}) // allow install to succeed even when offline
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const oldKeys = keys.filter(k => k !== CACHE_NAME);
    const newCache = await caches.open(CACHE_NAME);
    const newEntries = await newCache.keys();

    // If precaching failed (e.g. installed while offline), migrate old cache entries
    // into the new cache before deleting them — never leaves users with an empty cache.
    if (newEntries.length === 0 && oldKeys.length > 0) {
      for (const oldKey of oldKeys) {
        const oldCache = await caches.open(oldKey);
        const requests = await oldCache.keys();
        await Promise.all(requests.map(async req => {
          const res = await oldCache.match(req);
          if (res) await newCache.put(req, res);
        }));
      }
    }

    await Promise.all(oldKeys.map(k => caches.delete(k)));
  })());
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  // community-rules.json updates independently of a full app deploy (no
  // CACHE_VERSION bump), but the cache-first strategy below would otherwise
  // keep serving a stale cached copy forever regardless of the page's own
  // fetch(...,{cache:'no-store'}) — that request-level hint never reaches
  // the network if the SW answers from cache first. Network-first here so
  // categorization-rule updates actually reach online users; falls back to
  // the last cached copy (or a 503, handled as "rules unavailable" by the
  // app) when offline.
  if (url.pathname === '/community-rules.json') {
    e.respondWith(
      fetch(e.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return response;
      }).catch(() => caches.match(e.request).then(r => r || new Response('', {status: 503, statusText: 'Offline'})))
    );
    return;
  }

  // Normalize .html → clean URL so SW serves from cache instead of following
  // Cloudflare's 307 redirect (which may not resolve correctly inside a SW fetch).
  const cleanPath = HTML_CLEAN_URL[url.pathname];
  const cacheRequest = cleanPath
    ? new Request(new URL(cleanPath, url.origin).href)
    : e.request;

  e.respondWith(
    caches.match(cacheRequest).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (response.ok && e.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(cacheRequest, clone));
        }
        return response;
      }).catch(() => {
        if (e.request.mode === 'navigate') {
          const fallback = url.pathname.includes('trakyodollas') ? '/trakyodollas' : '/';
          return caches.match(new Request(new URL(fallback, url.origin).href)).then(r =>
            r || new Response(OFFLINE_PAGE, {headers: {'Content-Type': 'text/html;charset=utf-8'}})
          );
        }
        return new Response('', {status: 503, statusText: 'Offline'});
      });
    })
  );
});
