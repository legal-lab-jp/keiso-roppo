const APP_VERSION = "0.1.2-test";
const CONTENT_VERSION = "2026-08-15.test1";
const SHELL_CACHE = `keiso-roppo-shell-v${APP_VERSION}`;
const CONTENT_CACHE = `keiso-roppo-content-${CONTENT_VERSION}`;

const shellAssets = [
  "./",
  "./index.html",
  `./index.html?v=${APP_VERSION}`,
  "./manifest.webmanifest",
  "./version.json",
  `./assets/css/app.css?v=${APP_VERSION}`,
  `./js/app.js?v=${APP_VERSION}`,
  "./js/router.js",
  "./js/render.js",
  "./js/search.js",
  "./js/storage.js",
  "./js/import-export.js",
  "./js/pwa.js",
  "./assets/icons/app-icon.svg",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-180.png"
];

const contentAssets = [
  `./data/catalog.json?cv=${CONTENT_VERSION}`,
  `./data/articles/320.json?cv=${CONTENT_VERSION}`,
  `./data/articles/321.json?cv=${CONTENT_VERSION}`,
  `./data/articles/322.json?cv=${CONTENT_VERSION}`
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    const content = await caches.open(CONTENT_CACHE);
    await shell.addAll(shellAssets);
    await content.addAll(contentAssets);
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith("keiso-roppo-") && name !== SHELL_CACHE && name !== CONTENT_CACHE)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith("/version.json")) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        const response = await fetch(new Request(request, { cache: "no-store" }));
        if (response.ok) cache.put(request, response.clone());
        return response;
      } catch {
        return (await cache.match(request, { ignoreSearch: true })) || Response.error();
      }
    })());
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match("./index.html", { ignoreSearch: true });
      if (cached) return cached;
      return fetch(request);
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = url.pathname.includes("/data/") ? await caches.open(CONTENT_CACHE) : await caches.open(SHELL_CACHE);
    const cached = await cache.match(request, { ignoreSearch: false });
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  })());
});
