// PLUV - o servidor tem prioridade quando ha internet; o cache preserva o uso offline.
const VERSION='pluv-pwa-v14';
const FILES=['/','/index.html','/styles.css','/app.js','/db.js','/map.js','/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png','/icons/pluv.svg','/icons/pluviometro-campo.svg','/icons/pluviometro-serra.svg','/icons/pluviometro-lago.svg','/icons/pluviometro-pasto.svg'];
const isApi=path=>path.startsWith('/sync/')||path.startsWith('/auth/')||path==='/health';
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(FILES.map(path=>new Request(path,{cache:'reload'})))));
 self.skipWaiting();
});
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(key=>key.startsWith('pluv-pwa-')&&key!==VERSION).map(key=>caches.delete(key)));
  await self.clients.claim();
 })());
});
self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET'||new URL(request.url).origin!==self.location.origin)return;
 const url=new URL(request.url);
 if(isApi(url.pathname))return;
 const isPage=request.mode==='navigate';
 if(!isPage&&!FILES.includes(url.pathname))return;
 event.respondWith((async()=>{
  const cache=await caches.open(VERSION);
  try{
   const response=await fetch(request,{cache:'no-store'});
   if(response.ok){
    const cacheKey=isPage?'/index.html':url.pathname;
    event.waitUntil(cache.put(cacheKey,response.clone()).catch(()=>{}));
   }
   return response;
  }catch(error){
   const fallback=await cache.match(isPage?'/index.html':url.pathname);
   return fallback||new Response('PLUV indisponivel sem internet',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
  }
 })());
});
self.addEventListener('message',event=>{if(event.data==='SKIP_WAITING')self.skipWaiting()});
