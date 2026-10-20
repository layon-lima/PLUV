const VERSION='pluv-pwa-v4';
const FILES=['/','/index.html','/styles.css','/app.js','/db.js','/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png','/icons/pluviometro-campo.svg','/icons/pluviometro-serra.svg','/icons/pluviometro-lago.svg','/icons/pluviometro-pasto.svg'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(FILES)));self.skipWaiting()});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==VERSION).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET'||new URL(request.url).origin!==self.location.origin)return;
 const url=new URL(request.url);
 if(url.pathname.startsWith('/sync/')||url.pathname.startsWith('/auth/')||url.pathname==='/health')return;
 if(request.mode==='navigate'){
   event.respondWith(fetch(request).then(response=>{if(response.ok){const copy=response.clone();caches.open(VERSION).then(c=>c.put('/index.html',copy))}return response}).catch(()=>caches.match('/index.html')));return;
 }
 if(FILES.includes(url.pathname)) event.respondWith(caches.match(request).then(hit=>hit||fetch(request)));
});
self.addEventListener('message',event=>{if(event.data==='SKIP_WAITING')self.skipWaiting()});
