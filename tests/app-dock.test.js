import test from "node:test";
import assert from "node:assert/strict";
import { installAppDock } from "../client/src/app-dock.js";
import { subscribeRefresh } from "../client/src/copilot-context.js";

test("Ledger resolves movement/account names, reports ambiguity and refreshes mounted subscribers", async () => {
  const entries = [{ id: "e /1", counterparty: "Librería" }, { id: "e2", counterparty: "Libreria" }];
  const api = { entries: { get: async (id) => entries.find((e) => e.id === id), list: async () => ({ items: entries }) },
    state: async () => ({ accounts: [{ id: "a1", name: "Casa" }], categories: [{ id: "c1", name: "Libros" }] }) };
  const target = { location: { hash: "#/resumen" }, document: { querySelector: () => null }, dispatchEvent: () => {} };
  const dispose = installAppDock({ api, pages: ["resumen", "movimientos"] }, target);
  const queued = target.HoardApp.q;
  const tools = new Map(queued.filter(([m]) => m === "registerTool").map(([, n, d, h]) => [n, h]));
  assert.equal(tools.size, 3);
  const ctx = { cursor: { to: async () => {} } };
  await assert.rejects(tools.get("ledger_open")({ name: "librería" }, ctx), (e) => e.code === "ambiguous");
  await assert.rejects(tools.get("ledger_open")({ id: "missing" }, ctx), (e) => e.code === "not_found");
  await tools.get("ledger_open")({ id: "e /1" }, ctx);
  assert.equal(target.location.hash, "#/movimientos?tx=e%20%2F1");
  assert.equal(queued.find(([m]) => m === "setContext")[1]().focus.id, "e /1");
  await tools.get("ledger_filter")({ account: "casa", category: "Libros", text: "a & b" }, ctx);
  const query = new URLSearchParams(target.location.hash.split("?")[1]);
  assert.equal(query.get("account"), "a1"); assert.equal(query.get("category"), "c1"); assert.equal(query.get("from"), "");
  let refreshed = 0;
  const unsubscribe = subscribeRefresh(() => refreshed++);
  const changed = queued.find(([m]) => m === "onChanged")[1];
  changed(); await new Promise((resolve) => setTimeout(resolve, 300)); assert.equal(refreshed, 1);
  dispose(); changed(); await new Promise((resolve) => setTimeout(resolve, 300)); assert.equal(refreshed, 1);
  unsubscribe();
});
