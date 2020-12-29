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
    
            if (response.status !== 200 || !["cors", "basic"].includes(response.type) || /(\.mp3)$/.test(request.url)) {
              return response;
            }
            if(request.method === "GET") {
              const clone = response.clone();
              e.waitUntil(
                caches.open(cacheName).then(cache => cache.put(request.url, clone))
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