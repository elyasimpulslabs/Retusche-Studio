/* Retusche Studio Offline Speicher. Lädt nur Dateien von dieser Adresse, nichts von fremden Servern. */
const CACHE = "retusche-v10";
const SHELL = ["./", "index.html", "lib/jpeg/encoder.js", "lib/jpeg/decoder.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  const isCode = e.request.mode === "navigate" || /\.(html|css|js)$/.test(u.pathname) && !u.pathname.includes("/lib/");
  if (isCode) {
    /* App Code: erst Netz (immer aktuell), ohne Netz der letzte Stand */
    /* immer am Server nachfragen, damit alle Teile der App zusammen aktualisiert werden */
    e.respondWith(fetch(u.href, { cache: "no-cache", credentials: "same-origin" }).then((r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); } return r; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("index.html"))));
    return;
  }
  /* Bibliotheken und KI Modelle: aus dem Speicher, sonst laden und merken */
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((r2) => { if (r2.ok) { const c = r2.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); } return r2; })));
});
