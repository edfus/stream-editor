class FetchHandler {
  constructor (cacheName) {
    return e => 
      e.respondWith (
        caches.match(e.request.url).then(async response => {
          if (response) {
            return response;
          } else {
            const request = e.request.clone();
            const response = await fetch(request);
    
            if (response.status !== 200) {
              return response;
            }

            if (request.method === "GET" && ["cors", "basic"].includes(response.type)) {
              const cloned = response.clone();
              e.waitUntil(
                caches.open(cacheName).then(cache => cache.put(request.url, cloned))
              )
            }

            return response;
          }
        })
      )
    ;
  }
}
 
export default FetchHandler;