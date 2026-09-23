// Web app manifest plus a minimal service worker: makes the app installable
// as a PWA (Android "Add to Home screen" through the tunnel). The service
// worker only caches built /assets/ files (cache-first); every /api/ request
// always goes to the network and is never cached. No offline page.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

export function manifest() {
  return {
    name: "Ledger's Hoard",
    short_name: "Ledger's Hoard",
    start_url: "/",
    display: "standalone",
    background_color: "#fcfaf5",
    theme_color: "#8a5a19",
    lang: "es",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
    ],
  };
}

export function serviceWorker() {
  const cacheName = `ledgers-hoard-assets-v${version}`;
  return `// Minimal service worker: installability plus a cache-first strategy for
// built /assets/ files only. API calls are always network-only and never
// cached. No offline page.
const CACHE_NAME = ${JSON.stringify(cacheName)};

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return; // network only, never cached
  if (!url.pathname.startsWith("/assets/")) return; // everything else: normal browser handling

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response.ok) cache.put(event.request, response.clone());
      return response;
    })(),
  );
});
`;
}
