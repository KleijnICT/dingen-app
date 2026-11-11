// Service worker van Dingen. De Vite-plugin (vite.config.ts) vervangt de twee plaatshouders
// hieronder bij het bouwen: een buildnummer en de lijst bestanden die vooraf worden gecachet.
// Alleen statische bestanden komen in de cache; /api en /mcp gaan altijd naar het netwerk.

const BUILD = '__DINGEN_SW_BUILD__'
const PRECACHE = JSON.parse('__DINGEN_SW_PRECACHE__')
const CACHE = `dingen-${BUILD}`
const SHELL = '/index.html'

self.addEventListener('install', (event) => {
  // Geen skipWaiting: de nieuwe versie wacht tot de gebruiker herlaadt (zie src/pwa.ts).
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith('dingen-') && k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

function isApi(url) {
  return (
    url.pathname.startsWith('/api/') || url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')
  )
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || isApi(url)) return

  if (request.mode === 'navigate') {
    // Netwerk eerst, zodat een nieuwe versie meteen binnenkomt; offline val je terug op de shell.
    event.respondWith(fetch(request).catch(() => caches.match(SHELL)))
    return
  }

  // Het sw-bestand zelf en het manifest gaan altijd via het netwerk (de browser regelt updates).
  if (url.pathname === '/sw.js') return

  event.respondWith(caches.match(request).then((hit) => hit || fetch(request)))
})

// --- herinneringen ---
// Web push: de server stuurt { title, body, tag, url } op het moment van een herinnering.

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Dingen', {
      body: data.body || '',
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // An open Dingen only gets focus: navigating would reload it mid-edit.
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin)
      return open ? open.focus() : self.clients.openWindow(target)
    }),
  )
})
