// The Faustus copilot relay inside the app: /api/copilot/* routes, the launcher tag in the served page, and the manifest.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { ROOT } from "../server/app.js";

const DIST = path.join(ROOT, "dist");
const INDEX = path.join(DIST, "index.html");
const hadIndex = fs.existsSync(INDEX);
let fake;
let fakeUrl;
let s;

before(async () => {
  // A stand-in for Faustus: the capabilities probe and the panel script.
  fake = http.createServer((req, res) => {
    if (req.url === "/api/hoard-copilot/capabilities") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ contract_version: "1" })); }
    if (req.url === "/api/hoard-copilot/panel.js") { res.setHeader("content-type", "application/javascript"); return res.end("export const panel = true;"); }
    res.statusCode = 404; return res.end("{}");
  });
  await new Promise((resolve) => fake.listen(0, "127.0.0.1", resolve));
  fakeUrl = `http://127.0.0.1:${fake.address().port}`;
  process.env.HOARD_FAUSTUS_URL = fakeUrl;
  if (!hadIndex) { fs.mkdirSync(DIST, { recursive: true }); fs.writeFileSync(INDEX, "<!doctype html><html><body><div id=\"root\"></div></body></html>"); }
  const { bootServer } = await import("./helpers.js");
  s = await bootServer({ serveStatic: true });
});

after(async () => {
  await s.stop();
  await new Promise((resolve) => fake.close(resolve));
  delete process.env.HOARD_FAUSTUS_URL;
  if (!hadIndex) fs.rmSync(DIST, { recursive: true, force: true });
});

test("/api/copilot/info names the app and points at the same-origin panel", async () => {
  const response = await fetch(`${s.base}/api/copilot/info`);
  assert.equal(response.status, 200);
  const info = await response.json();
  assert.equal(info.app_id, "ledger");
  assert.equal(info.app_name, "Ledger's Hoard");
  assert.equal(info.panel_url, "/api/copilot/panel.js");
  assert.ok(info.data_space_id);
});

test("the panel script is relayed and the launcher is served", async () => {
  const panel = await fetch(`${s.base}/api/copilot/panel.js`);
  assert.equal(panel.status, 200);
  assert.match(await panel.text(), /panel = true/);
  const launcher = await fetch(`${s.base}/api/copilot/launcher.js`);
  assert.equal(launcher.status, 200);
  assert.match(launcher.headers.get("content-type"), /javascript/);
  assert.match(await launcher.text(), /hoardCopilot/);
});

test("the page the app serves carries the launcher tag", async () => {
  const html = await (await fetch(`${s.base}/`)).text();
  assert.match(html, /<script type="module" src="\/api\/copilot\/launcher\.js"><\/script>/);
  assert.equal((html.match(/launcher\.js/g) || []).length, 1);
});

test("the proxy only relays the copilot's own routes", async () => {
  const bad = await fetch(`${s.base}/api/copilot/proxy`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: "/api/admin/secrets", method: "GET" }) });
  assert.equal(bad.status, 400);
});

test("the manifest declares the copilot contract and what the context sends", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "faustus-plugin.json"), "utf8"));
  const copilot = manifest["x-family"].copilot;
  assert.equal(copilot.provider, "faustus");
  assert.equal(copilot.contract, "1.0");
  assert.equal(copilot.panel, "/api/copilot/panel.js");
  assert.ok(copilot.context.includes("entry") && copilot.context.includes("view.editor"));
  assert.equal(manifest["x-family"].agenda, true);   // the existing declaration is untouched
});
