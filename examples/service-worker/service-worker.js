import FetchHandler from "./assets/network-first.js";
import cacheResources from "./assets/cache-resouces.js.js";
import DLC from "./assets/downloadable.js";

const version = "Whatever";
const cacheName = "cache-" + version;

self.addEventListener('install', e => {
  self.skipWaiting();
  return e.waitUntil(
    caches.open(cacheName).then(cache =>
      cache.addAll(cacheResources)
        .then(() => {
          if('connection' in navigator && !navigator.connection.saveData && DLC.length){
            cache.addAll(DLC);
          }
        })
    )
  )
})

self.addEventListener('activate', e => {
  console.info('[ServiceWorker] Activate.');
  e.waitUntil(
    caches.keys().then(keyList => 
      Promise.all(keyList.map(key => {
        if (key !== cacheName) {
          console.info('[ServiceWorker] Removing old cache: ', key);
          return caches.delete(key);
        }
      }))
    )
  )
  return self.clients.claim();
});

self.addEventListener('fetch', new FetchHandler(cacheName));