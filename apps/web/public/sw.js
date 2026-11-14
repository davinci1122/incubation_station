// オフラインでも画面を開けるようにする最小限のService Worker。
// ページ本体は「まず通信、だめならキャッシュ」、その他の同一オリジンのファイルは「キャッシュを返しつつ裏で更新」。
const CACHE = "cabinet-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(self.registration.scope, copy));
          return response;
        })
        .catch(() => caches.match(self.registration.scope).then((hit) => hit || Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(request).then((hit) => {
        const refresh = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => hit || Response.error());
        return hit || refresh;
      }),
    ),
  );
});
