const CACHE_NAME = "dynamusic-shell-v1";
const CORE_ASSETS = [
  "/",
  "/?window=dynamusic",
  "/index.html",
  "/intro.js",
  "/manifest.webmanifest",
  "/dynamusic-icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Never cache RPC, SSE, or stream proxy endpoints (offline audio is stored in IndexedDB)
  if (
    url.pathname === "/rpc" ||
    url.pathname === "/events" ||
    url.pathname === "/health" ||
    url.pathname === "/lan-info" ||
    url.searchParams.has("id") ||
    url.searchParams.has("lid")
  ) {
    return;
  }

  // Cache-first with background refresh for same-origin static assets & artwork thumbnails
  if (url.origin === self.location.origin || url.hostname.endsWith("ytimg.com") || url.hostname.endsWith("ggpht.com") || url.hostname.endsWith("googleusercontent.com")) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(req);
        const networkPromise = fetch(req)
          .then((res) => {
            if (res && (res.status === 200 || res.type === "opaque")) {
              cache.put(req, res.clone()).catch(() => undefined);
            }
            return res;
          })
          .catch(() => null);

        if (cached) {
          return cached;
        }
        const net = await networkPromise;
        if (net) return net;
        if (req.mode === "navigate") {
          const fallback = (await cache.match("/?window=dynamusic")) || (await cache.match("/index.html")) || (await cache.match("/"));
          if (fallback) return fallback;
        }
        return new Response("Offline", { status: 503 });
      })
    );
  }
});

