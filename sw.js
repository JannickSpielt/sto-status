// Speichert die App-Hülle für den Offline-Start. Daten kommen immer frisch aus dem Netz.
const CACHE = "sto-status-v2";
const SHELL = ["./", "index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== "GET") return;

  // Daten: immer Netz, bei Funkloch die letzte Kopie
  if (url.pathname.includes("/data/")) {
    e.respondWith(
      fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(url.pathname, copy));
        return res;
      }).catch(() => caches.match(url.pathname))
    );
    return;
  }

  // App-Hülle: Netz zuerst, damit Updates sofort ankommen
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match("index.html")))
  );
});
