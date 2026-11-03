// オフライン用のキャッシュ。ファイルを更新したら VERSION を上げる
// （index.html の APP_VERSION も同じ値にそろえる）
const VERSION = "v3.3";
const CACHE = "calendar-" + VERSION;
const FILES = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (e) => {
  // インストール時もHTTPキャッシュを使わず、必ず最新を取りに行く
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.all(FILES.map((f) =>
        fetch(f, { cache: "no-store" }).then((res) => c.put(f, res))
      ))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  // 自サイトのファイルだけ扱う（APIへの通信はそのまま通す）
  if (url.origin !== location.origin) return;
  e.respondWith(
    // 通信できるときは常に最新（HTTPキャッシュを使わない）、オフラインのときだけ保存済みのものを使う
    fetch(e.request.url, { cache: "no-store" })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("./index.html")))
  );
});
