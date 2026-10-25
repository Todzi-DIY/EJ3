// ============================================================
// EJ3 Service Worker
// Cilė: sumažinti krovimosi laiką kešuojant CDN failus
// ============================================================

const CACHE_VERSION = 'ej3-v1';
const CACHE_NAME = `ej3-cache-${CACHE_VERSION}`;

// CDN failai, kuriuos kešuojame (jie nesikeičia)
const CDN_URLS = [
    'https://docs.opencv.org/4.8.0/opencv.js',
    'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

// Install event - kešuojame CDN failus
self.addEventListener('install', (event) => {
    console.log('[SW] Install');
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] Kešuojami CDN failai');
            return Promise.allSettled(
                CDN_URLS.map(url => 
                    cache.add(url).catch(err => 
                        console.warn(`[SW] Nepavyko kešuoti ${url}:`, err.message)
                    )
                )
            );
        }).then(() => self.skipWaiting())
    );
});

// Activate event - išvalome senus kešus
self.addEventListener('activate', (event) => {
    console.log('[SW] Activate');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[SW] Trinamas senas kešas:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch event - strategija:
// 1. CDN failai -> cache-first
// 2. HTML/JS/CSS -> network-first su cache fallback
// 3. Kiti -> network-only
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    
    // CDN failai - cache-first
    if (CDN_URLS.some(cdn => event.request.url === cdn || event.request.url.startsWith(cdn))) {
        event.respondWith(
            caches.match(event.request).then((cached) => {
                if (cached) {
                    return cached;
                }
                return fetch(event.request).then((response) => {
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    }
                    return response;
                });
            })
        );
        return;
    }
    
    // HTML/JS/CSS failai - network-first
    if (url.origin === self.location.origin) {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    if (response.ok && response.status === 200) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    }
                    return response;
                })
                .catch(() => {
                    return caches.match(event.request).then((cached) => {
                        if (cached) return cached;
                        // Fallback į index.html jei navigacija
                        if (event.request.mode === 'navigate') {
                            return caches.match('/index.html');
                        }
                        return new Response('Offline', { status: 503 });
                    });
                })
        );
        return;
    }
    
    // Kiti (ESP32 užklausos, Worker'io užklausos) - network-only
    // NEKEŠUOJAME, nes tai dinaminiai duomenys
});
