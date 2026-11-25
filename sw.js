// Keeps the game playable offline once it has been opened.
// The page itself is fetched fresh when there is a connection, so updates arrive straight away;
// everything else (the 3D models, three.js, the fonts) is served from the cache first.
var CACHE='bookstore-cafe-v1';
var CORE=['./','index.html','models.json','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png','icons/icon-180.png',
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'];
self.addEventListener('install',function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){return Promise.all(CORE.map(function(u){return c.add(u).catch(function(){});}));}).then(function(){return self.skipWaiting();}));
});
self.addEventListener('activate',function(e){
  e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.filter(function(k){return k!==CACHE;}).map(function(k){return caches.delete(k);}));}).then(function(){return self.clients.claim();}));
});
self.addEventListener('fetch',function(e){
  var r=e.request;if(r.method!=='GET')return;
  var u=new URL(r.url),page=r.mode==='navigate'||(u.origin===location.origin&&/\/(index\.html)?$/.test(u.pathname));
  var fresh=page||(u.origin===location.origin&&/models\.json$/.test(u.pathname));
  if(fresh){      // network first, cache as a fallback
    e.respondWith(fetch(r).then(function(res){var cp=res.clone();caches.open(CACHE).then(function(c){c.put(r,cp);});return res;})
      .catch(function(){return caches.match(r,{ignoreSearch:true}).then(function(m){return m||caches.match('index.html');});}));
    return;
  }
  e.respondWith(caches.match(r).then(function(m){return m||fetch(r).then(function(res){
    if(res.ok||res.type==='opaque'){var cp=res.clone();caches.open(CACHE).then(function(c){c.put(r,cp);});}return res;});}));
});
