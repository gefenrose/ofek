const VERSION = 'ofek-v22';

const CORE_ASSETS = [
  './index.html',
  './src/css/app.css',
  './src/js/theme.js',
  './src/js/storage.js',
  './src/js/a11y.js',
  './src/js/i18n.js',
  './src/js/image-utils.js',
  './src/js/cloud-sync.js',
  './src/js/screen-lock.js',
  './src/js/data-transfer.js',
  './src/js/ai-settings.js',
  './src/js/daily-summaries.js',
  './src/js/app.js',
  './manifest.webmanifest',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png'
];

async function cacheCoreAssets(){
  const cache = await caches.open(VERSION);
  await Promise.all(CORE_ASSETS.map(async (url) => {
    const response = await fetch(url, { cache:'no-store' });
    if(!response.ok) throw new Error(`Core asset failed: ${url} (${response.status})`);
    await cache.put(url, response);
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheCoreAssets().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key.startsWith('ofek-') && key !== VERSION).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

function isNavigation(request){
  return request.method === 'GET' && request.mode === 'navigate';
}

async function navigationResponse(request){
  const cache = await caches.open(VERSION);
  try{
    const response = await fetch(request, { cache:'no-store' });
    if(response.ok && (response.headers.get('Content-Type') || '').includes('text/html')){
      await cache.put('./index.html', response.clone());
    }
    return response;
  }catch(error){
    const cached = await cache.match('./index.html');
    return cached || new Response('Ofek is unavailable offline until it has loaded once.', {
      status:503,
      headers:{ 'Content-Type':'text/plain; charset=utf-8' }
    });
  }
}

async function assetResponse(request){
  const cache = await caches.open(VERSION);
  try{
    const response = await fetch(request, { cache:'no-store' });
    if(response.ok) await cache.put(request, response.clone());
    return response;
  }catch(error){
    const cached = await cache.match(request);
    return cached || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if(isNavigation(request)){
    event.respondWith(navigationResponse(request));
    return;
  }
  if(request.method !== 'GET') return;
  const url = new URL(request.url);
  if(url.origin !== self.location.origin || request.headers.has('Authorization')) return;
  if(url.pathname.includes('/api/')) return;
  event.respondWith(assetResponse(request));
});

self.addEventListener('message', (event) => {
  if(event.data === 'skipWaiting') self.skipWaiting();
});
