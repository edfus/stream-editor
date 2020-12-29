class FetchHandler {
  constructor (cacheName) {
    return e => 
      e.respondWith (
        (async () => {
          let response = await e.preloadResponse;

          if (!response) {
            try {
              response = await fetch(e.request);
            } finally {
              if(!response) {
                return await caches.match(e.request.url) || Response.error();
              } else if (response.status !== 200) {
                if(response.status === 0)
                  ; // no-cors opaque response
                else
                  return await caches.match(e.request.url) || response;
              }
            }
          }

          // got non-cached 0 or 200 response
          if(e.request.method === "GET" && ["opaque", "cors", "basic"].includes(response.type)) {
            // cache the opaque response regardless of it failed or not
            // as this is the network-first mode.
            const clone = response.clone();
            e.waitUntil(
              caches.open(cacheName).then(cache => cache.put(e.request.url, clone))
            );
          }
          return response;
        })()
      )
    ;
  }
}

export default FetchHandler;