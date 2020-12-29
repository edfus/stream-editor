class FetchHandler {
  constructor (cacheName) {
    return e => 
      e.respondWith (
        (async () => {
          let response = await e.preloadResponse;

          if (!response) {
            try {
              response = await fetch(e.request)
            } finally {
              if(!response) {
                const cacheResponse = await caches.match(e.request.url)
                return cacheResponse ? cacheResponse : Response.error();
              } else if (response.status !== 200) {
                if(response.status === 0)
                  ; // no-cors opaque response
                else {
                  const cacheResponse = await caches.match(e.request.url)
                  return cacheResponse ? cacheResponse : response;
                }
              }
            }
          }

          // got non-cached ok response
          if(e.request.method === "GET" && ["opaque", "cors", "basic"].includes(response.type) || /(\.mp3)$/.test(request.url)) {
            const clone = response.clone();
            e.waitUntil(
              caches.open(cacheName).then(cache => cache.put(e.request.url, clone))
            )
            // put() will overwrite any key/value pair previously stored in the cache that matches the request.
          }
          return response;
        })()
      )
    ;
  }
}

export default FetchHandler;