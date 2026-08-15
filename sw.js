const APP_VERSION = "1.0.1";
const CONTENT_VERSION = "2026-08-15.exam114.1";
const SHELL_CACHE = `keiso-roppo-shell-v${APP_VERSION}`;
const CONTENT_CACHE = `keiso-roppo-content-${CONTENT_VERSION}`;
const OFFLINE_MANIFEST = "./data/offline-assets.json";

async function offlineAssets() {
  const response = await fetch(new Request(OFFLINE_MANIFEST, { cache: "no-store" }));
  if (!response.ok) throw new Error(`offline-assets取得失敗: ${response.status}`);
  const manifest = await response.json();
  if (manifest.contentVersion !== CONTENT_VERSION || !Array.isArray(manifest.shellAssets) || !Array.isArray(manifest.contentAssets)) throw new Error("offline-assetsの形式又はversionが不正です");
  const all = [...manifest.shellAssets, ...manifest.contentAssets];
  if (new Set(all).size !== all.length) throw new Error("offline-assetsに重複URLがあります");
  return manifest;
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const manifest = await offlineAssets();
    const shell = await caches.open(SHELL_CACHE);
    const content = await caches.open(CONTENT_CACHE);
    await shell.addAll(manifest.shellAssets);
    await content.addAll(manifest.contentAssets);
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
        if (response.ok) await cache.put(request, response.clone());
        return response;
      } catch {
        return (await cache.match(request, { ignoreSearch: true })) || Response.error();
      }
    })());
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      const shell = await caches.open(SHELL_CACHE);
      return (await shell.match("./index.html", { ignoreSearch: true })) || fetch(request);
    })());
    return;
  }

  event.respondWith((async () => {
    const isContent = url.pathname.includes("/data/");
    const cache = await caches.open(isContent ? CONTENT_CACHE : SHELL_CACHE);
    const cached = await cache.match(request, { ignoreSearch: false }) || await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  })());
});
