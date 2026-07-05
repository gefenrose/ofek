const VERSION = 'ofek-v15';
const OFEK_AI_ENDPOINT = 'https://ofek-api.gefenrose.workers.dev';
const LEGACY_AI_ENDPOINT = 'https://serenity-api.gefenrose.workers.dev';

const CORE_ASSETS = [
  './index.html',
  './src/js/ai-settings.js',
  './manifest.webmanifest',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => Promise.all(CORE_ASSETS.map((url) =>
        fetch(url, { cache: 'no-store' }).then((res) => cache.put(url, res)).catch(() => {})
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function shouldServeAppShell(req) {
  if (req.method !== 'GET') return false;
  if (req.mode === 'navigate') return true;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return false;
  return url.pathname.endsWith('/ofek/') || url.pathname.endsWith('/ofek/index.html') || url.pathname.endsWith('/index.html');
}

async function appShellResponse(req) {
  const cache = await caches.open(VERSION);
  let source;

  try {
    source = await fetch(req, { cache: 'no-store' });
    if (source && source.ok) {
      const plainCopy = source.clone();
      cache.put('./index.html', plainCopy).catch(() => {});
    }
  } catch (e) {
    source = await cache.match('./index.html');
  }

  if (!source) {
    source = await cache.match('./index.html');
  }

  if (!source) {
    return new Response('Ofek is unavailable offline until it has loaded once.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }

  return source;
}

async function redirectLegacyAi(req) {
  const headers = new Headers(req.headers);
  headers.set('Content-Type', 'application/json');

  const init = {
    method: req.method,
    headers,
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'follow'
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.clone().text();
  }

  return fetch(OFEK_AI_ENDPOINT, init);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Safety net: if old frontend code still calls the legacy Serenity worker,
  // route it to Ofek's dedicated BYOK-only worker instead.
  if (req.url.startsWith(LEGACY_AI_ENDPOINT)) {
    event.respondWith(redirectLegacyAi(req));
    return;
  }

  if (shouldServeAppShell(req)) {
    event.respondWith(appShellResponse(req));
    return;
  }

  if (req.method !== 'GET') return;

  // Never cache live API calls.
  if (req.url.includes('workers.dev') || req.url.includes('/api/')) return;

  event.respondWith(
    fetch(req, { cache: 'no-store' })
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((cache) => cache.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || appShellResponse(req)))
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
