const APP_CACHE = 'focus-cache-v1'
const APP_SHELL = ['/', '/index.html']

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_CACHE).then(cache => cache.addAll(APP_SHELL)),
  )
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(
          keys.filter(key => key !== APP_CACHE).map(key => caches.delete(key)),
        ),
      ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', event => {
  const { request } = event

  if (
    request.method !== 'GET' ||
    (request.cache === 'only-if-cached' && request.mode !== 'same-origin')
  ) {
    return
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(APP_CACHE)
      const cached = await cache.match(request)

      try {
        const response = await fetch(request)

        if (
          response &&
          response.status === 200 &&
          (response.type === 'basic' || response.type === 'cors')
        ) {
          cache.put(request, response.clone())
        }

        return response
      } catch (error) {
        if (cached) {
          return cached
        }

        if (request.mode === 'navigate') {
          const fallback = await cache.match('/')
          if (fallback) {
            return fallback
          }
        }

        throw error
      }
    })(),
  )
})
