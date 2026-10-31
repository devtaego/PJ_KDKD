// 홈 화면에 추가(설치)할 수 있게 하는 최소한의 서비스 워커.
// 항상 네트워크를 먼저 쓰고, 연결이 없을 때만 저장해 둔 화면을 보여 줌 (옛 버전이 남지 않도록)
const CACHE = "kidk-v1";
self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).pathname.startsWith("/ws")) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok && new URL(req.url).origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req))
  );
});
