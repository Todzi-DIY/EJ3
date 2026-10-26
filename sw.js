// ============================================================
// EJ3 Service Worker
// Cilė: sumažinti krovimosi laiką kešuojant CDN failus
// Versija: ej3-v2 (atnaujinta 2026-10-26)
// Pakeitimai:
//   - CACHE_VERSION pakeltas į v2 (dėl index.html atnaujinimo)
//   - Pridėtas fallback į index.html navigacijos atveju
//   - Pridėtas Response 503 fallback, jei nėra kešo
//   - Pridėtas cache busting per URL query (t.y. ?v=...)
// ============================================================

const CACHE_VERSION = 'ej3-v2';
const CACHE_NAME = `ej3-cache-${CACHE_VERSION}`;

// CDN failai, kuriuos kešuojame (jie nesikeičia)
const CDN_URLS = [
    'https://docs.opencv.org/4.8.0/opencv.js',
    'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

// ============================================================
// INSTALL – kešuojame CDN failus
// ============================================================
self.addEventListener('install', (event) => {
    console.log('[SW] Install – versija:', CACHE_VERSION);
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

// ============================================================
// ACTIVATE – išvalome senus kešus
// ============================================================
self.addEventListener('activate', (event) => {
    console.log('[SW] Activate – versija:', CACHE_VERSION);
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

// ============================================================
// FETCH – strategija:
//   1. CDN failai -> cache-first
//   2. HTML/JS/CSS (same-origin) -> network-first su cache fallback
//   3. Kiti (ESP32 užklausos, Worker'io užklausos) -> network-only
// ============================================================
self.addEventListener('fetch', (event) => {
    // Ignoruojame ne-GET užklausas (POST į Worker'į, OTA upload ir kt.)
    if (event.request.method !== 'GET') {
        return; // Leidžiame naršyklei tvarkyti
    }

    const url = new URL(event.request.url);

    // ------------------------------------------------------------
    // 1. CDN failai – cache-first
    // ------------------------------------------------------------
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
                }).catch(() => {
                    // Jei CDN nepasiekiamas ir nėra kešo
                    return new Response('CDN unavailable', { status: 503 });
                });
            })
        );
        return;
    }

    // ------------------------------------------------------------
    // 2. Same-origin (index.html, sw.js, manifest ir kt.)
    //    network-first su cache fallback
    // ------------------------------------------------------------
    if (url.origin === self.location.origin) {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    // Kešuojame tik sėkmingus GET atsakymus
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
                            return caches.match('/index.html').then(cachedIndex => {
                                if (cachedIndex) return cachedIndex;
                                return new Response('Offline – puslapis nerastas keše', {
                                    status: 503,
                                    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                                });
                            });
                        }

                        return new Response('Offline', { status: 503 });
                    });
                })
        );
        return;
    }

    // ------------------------------------------------------------
    // 3. Kiti (ESP32 užklausos į http://192.168.x.x, Worker'io užklausos)
    //    network-only – NEKEŠUOJAME, nes tai dinaminiai duomenys
    // ------------------------------------------------------------
    // Leidžiame naršyklei tvarkyti tiesiogiai (be respondWith)
});

// ============================================================
// MESSAGE – leidžiame iš pagrindinio puslapio priverstinai atnaujinti SW
// (naudojama, jei norime priversti vartotoją gauti naują versiją)
// ============================================================
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        console.log('[SW] Gautas SKIP_WAITING pranešimas');
        self.skipWaiting();
    }
    if (event.data && event.data.type === 'CLEAR_CACHE') {
        console.log('[SW] Gautas CLEAR_CACHE pranešimas');
        caches.keys().then(names => {
            return Promise.all(names.map(name => caches.delete(name)));
        }).then(() => {
            if (event.source) {
                event.source.postMessage({ type: 'CACHE_CLEARED' });
            }
        });
    }
});
