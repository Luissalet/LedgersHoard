import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "./helpers.js";

let s;
before(async () => { s = await bootServer(); });
after(async () => { await s.stop(); });

test("manifest is served with the required PWA fields", async () => {
  const response = await fetch(`${s.base}/manifest.webmanifest`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^application\/manifest\+json/);
  const body = await response.json();
  assert.equal(body.name, "Ledger's Hoard");
  assert.equal(body.short_name, "Ledger's Hoard");
  assert.equal(body.start_url, "/");
  assert.equal(body.display, "standalone");
  assert.equal(body.lang, "es");
  assert.ok(body.background_color);
  assert.ok(body.theme_color);
  const sizes = body.icons.map((icon) => icon.sizes);
  assert.ok(sizes.includes("192x192"));
  assert.ok(sizes.includes("512x512"));
});

test("service worker is served as JS, installable at the root scope", async () => {
  const response = await fetch(`${s.base}/sw.js`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^application\/javascript/);
  assert.equal(response.headers.get("service-worker-allowed"), "/");
  const body = await response.text();
  assert.match(body, /skipWaiting/);
  assert.match(body, /clients\.claim/);
  assert.match(body, /\/api\//);
  assert.match(body, /\/assets\//);
});
