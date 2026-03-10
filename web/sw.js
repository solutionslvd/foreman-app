/* ═══════════════════════════════════════════════════════════
   Foreman Alberta - Service Worker v2.0
   PWA offline support, caching, background sync
═══════════════════════════════════════════════════════════ */

const CACHE_NAME = 'foreman-v2.0.0';
const STATIC_CACHE = 'foreman-static-v2';
const API_CACHE = 'foreman-api-v2';

// Files to cache for offline use
const STATIC_FILES = [
  '/app',
  '/static/app.css',
  '/static/app.js',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap',
];

// API routes to cache
const CACHEABLE_API = [
  '/api/settings/public',
  '/health',
];

// ── Install ─────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installing Foreman Service Worker...');
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(STATIC_FILES).catch((err) => {
        console.warn('[SW] Some files failed to cache:', err);
      });
    }).then(() => {
      console.log('[SW] Static files cached');
      return self.skipWaiting();
    })
  );
});

// ── Activate ────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating Foreman Service Worker...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter(name => name !== STATIC_CACHE && name !== API_CACHE)
          .map(name => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      console.log('[SW] Service Worker activated');
      return self.clients.claim();
    })
  );
});

// ── Fetch Strategy ──────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip chrome-extension and other non-http
  if (!url.protocol.startsWith('http')) return;

  // API requests - Network first, fallback to cache
  if (url.pathname.startsWith('/api/')) {
    if (CACHEABLE_API.some(path => url.pathname.startsWith(path))) {
      event.respondWith(networkFirstWithCache(request, API_CACHE));
    }
    return; // Don't cache other API calls
  }

  // Static assets - Cache first
  if (url.pathname.startsWith('/static/') || 
      url.pathname === '/manifest.json' ||
      url.pathname === '/sw.js') {
    event.respondWith(cacheFirstWithNetwork(request, STATIC_CACHE));
    return;
  }

  // App pages - Network first, fallback to cached app shell
  if (url.pathname === '/app' || url.pathname === '/') {
    event.respondWith(networkFirstWithFallback(request, STATIC_CACHE, '/app'));
    return;
  }

  // Default - network only
  event.respondWith(fetch(request).catch(() => {
    return caches.match('/app');
  }));
});

// ── Cache Strategies ────────────────────────────────────

async function cacheFirstWithNetwork(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch(e) {
    return new Response('Offline - resource not cached', { status: 503 });
  }
}

async function networkFirstWithCache(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch(e) {
    const cached = await caches.match(request);
    return cached || new Response(JSON.stringify({ error: 'Offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function networkFirstWithFallback(request, cacheName, fallbackUrl) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch(e) {
    const cached = await caches.match(request) || await caches.match(fallbackUrl);
    return cached || new Response('<h1>Offline</h1><p>Please check your connection.</p>', {
      headers: { 'Content-Type': 'text/html' }
    });
  }
}

// ── Background Sync ─────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-transactions') {
    event.waitUntil(syncPendingTransactions());
  }
});

async function syncPendingTransactions() {
  // In production: sync offline-created transactions when back online
  console.log('[SW] Syncing pending transactions...');
}

// ── Push Notifications ──────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;
  
  const data = event.data.json();
  const options = {
    body: data.body || 'New notification from Foreman',
    icon: '/static/icons/icon-192.png',
    badge: '/static/icons/icon-72.png',
    vibrate: [100, 50, 100],
    data: { url: data.url || '/app' },
    actions: [
      { action: 'view', title: 'View', icon: '/static/icons/icon-72.png' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Foreman Alberta', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  
  const url = event.notification.data?.url || '/app';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

console.log('[SW] Foreman Service Worker loaded v2.0.0');