// What Ledger takes from the family's commons (Hoard Link 0.8): money and dates, merchants, the re-keying migration,
// alerts through the hub with the toast as fallback, and the shared plumbing (token, guard, errors, bridge).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "./helpers.js";
import { captureNotifications } from "./mail-helpers.js";
import { parseAmount, formatCents, detectColumnDecimal } from "../shared/money.js";
import { findMoney, findDates, findOrderRef } from "../server/mail-parse.js";
import { merchantKey as mailKey, merchantMatches, SHOP_CATS } from "../server/mail-match.js";
import { merchantKey as recurringKey } from "../server/recurring.js";
import { addDays, daysBetween } from "../server/dates.js";
import { notify, beginBatch, flushBatch, listNotifications } from "../server/notifications.js";
import { updateMailSettings, mailSettings } from "../server/mail-settings.js";

// ------------------------------------------------------------------ money, dates, order references, merchants
test("money: the family's rules behind the names the app has always used", () => {
  assert.equal(parseAmount("1.234,56"), 123456);
  assert.equal(parseAmount("(12.00)"), -1200);
  assert.equal(parseAmount("12,5 €"), 1250);
  assert.equal(parseAmount("abc"), null);
  assert.equal(parseAmount("1.234", { decimal: "," }), 123400);
  assert.equal(parseAmount("1,234", { decimal: "," }), 123);
  assert.equal(detectColumnDecimal(["1.234,56", "12,00"]), ",");
  assert.equal(formatCents(123456), "1.234,56 €");
  assert.equal(formatCents(-5, ""), "-0,05");
});

test("money: findMoney reads other currencies and keeps cents as integers", () => {
  const hits = findMoney("Total: 12,99 USD and £4.50, o 9,90 €");
  assert.ok(hits.some((h) => h.cents === 1299 && h.currency === "USD"), JSON.stringify(hits));
  assert.ok(hits.some((h) => h.cents === 450 && h.currency === "GBP"), JSON.stringify(hits));
  assert.ok(hits.some((h) => h.cents === 990 && h.currency === "EUR"), JSON.stringify(hits));
});

test("dates: shared addDays/daysBetween, year-less dates resolve against the mail date", () => {
  assert.equal(addDays("2026-01-31", 1), "2026-02-01");
  assert.equal(daysBetween("2026-01-01", "2026-03-01"), 59);
  const past = findDates("Cargo realizado el 28 de diciembre", "2026-01-03", "past");
  assert.ok(past.some((d) => d.date === "2025-12-28"), JSON.stringify(past));
  const future = findDates("Se renovara el 5 de enero", "2025-12-20", "future");
  assert.ok(future.some((d) => d.date === "2026-01-05"), JSON.stringify(future));
});

test("order references come from the shared finder", () => {
  assert.equal(findOrderRef("pedido confirmado", "tu numero de pedido: 402-1234567-8901234 gracias"), "402-1234567-8901234");
  assert.equal(findOrderRef("hola", "nada que ver aqui"), null);
});

test("merchants: one table for the family; keys drop legal suffixes and shops are not subscriptions", () => {
  assert.equal(mailKey("Bar Manolo S.L."), "bar manolo");
  assert.equal(mailKey("Netflix"), mailKey("NETFLIX.COM"));
  assert.equal(recurringKey("Bar Manolo S.L."), "bar manolo");
  assert.ok(merchantMatches("Spotify AB", "spotify"));
  assert.equal(merchantMatches("Spotify", "Mercadona"), false);
  assert.ok(SHOP_CATS.size > 0);
});

// ------------------------------------------------------------------ alerts: the hub first, the toast as fallback
let s;
let sink;
before(async () => { s = await bootServer(); });
after(async () => { sink?.restore(); await s.stop(); });

const alert = (n, severity = "high") => ({ kind: "test", severity, title: `Aviso ${n}`, body: `Cuerpo ${n}`, dedupe_key: `commons:${n}:${Math.random()}`, url: "" });

test("alerts go through the hub with priority, group and dedupe key; no toast when the hub took them", async () => {
  sink = captureNotifications({ platform: "win32", hub: true });
  updateMailSettings({ toast: true, notify_via: "auto" });
  const stored = await notify(alert(1));
  assert.equal(sink.notices.length, 1);
  assert.equal(sink.notices[0].title, "Aviso 1");
  assert.equal(sink.notices[0].priority, "high");
  assert.equal(sink.notices[0].group, "ledger");
  assert.equal(sink.notices[0].dedupeKey, stored.dedupe_key);
  assert.equal(sink.scripts.length, 0);
  const delivered = listNotifications({ limit: 1 })[0].delivered;
  assert.equal(delivered.via, "hub");
  assert.equal(delivered.toast, true);
  sink.restore();
});

test("without the hub the same alert is a Windows toast with the app's name", async () => {
  sink = captureNotifications({ platform: "win32", hub: false });
  updateMailSettings({ toast: true, notify_via: "auto" });
  await notify(alert(2, "medium"));
  assert.equal(sink.notices.length, 0);
  assert.equal(sink.scripts.length, 1);
  assert.equal(listNotifications({ limit: 1 })[0].delivered.via, "own");
  sink.restore();
});

test("a message the hub holds back on purpose (quiet hours) is not repeated as a toast", async () => {
  sink = captureNotifications({ platform: "win32", hub: true, held: "quiet_hours" });
  updateMailSettings({ toast: true, notify_via: "auto" });
  await notify(alert(3));
  assert.equal(sink.notices.length, 1);
  assert.equal(sink.scripts.length, 0);
  const delivered = listNotifications({ limit: 1 })[0].delivered;
  assert.equal(delivered.held, "quiet_hours");
  sink.restore();
});

test("notify_via: 'own' never asks the hub, 'hub' never falls back to a toast", async () => {
  sink = captureNotifications({ platform: "win32", hub: true });
  updateMailSettings({ notify_via: "own" });
  await notify(alert(4));
  assert.equal(sink.notices.length, 0);
  assert.equal(sink.scripts.length, 1);
  sink.restore();
  sink = captureNotifications({ platform: "win32", hub: false });
  updateMailSettings({ notify_via: "hub" });
  await notify(alert(5));
  assert.equal(sink.scripts.length, 0, "the hub is off and the person asked for the hub only");
  assert.equal(mailSettings().notify_via, "hub");
  assert.throws(() => updateMailSettings({ notify_via: "carrier-pigeon" }));
  updateMailSettings({ notify_via: "auto" });
  sink.restore();
});

test("a batch is condensed: at most 3 alerts and one summary", async () => {
  sink = captureNotifications({ platform: "win32", hub: true });
  updateMailSettings({ toast: true, notify_via: "auto" });
  beginBatch();
  for (let i = 10; i < 16; i++) await notify(alert(i));
  assert.equal(sink.notices.length, 0, "nothing is sent while the batch is open");
  await flushBatch();
  assert.equal(sink.notices.length, 4);
  assert.match(sink.notices[3].body, /3 avisos nuevos/);
  sink.restore();
});

// ------------------------------------------------------------------ plumbing
test("unknown routes and tools, bad JSON and the token answer with the family's error envelope", async () => {
  const miss = await s.call("GET", "/api/nope");
  assert.equal(miss.status, 404);
  assert.equal(miss.body.code, "not_found");
  const noToken = await s.call("POST", "/api/agent/call", { name: "list_accounts" });
  assert.equal(noToken.status, 401);
  assert.equal(noToken.body.code, "unauthorized");
  const unknown = await s.agent("no_such_tool", {});
  assert.equal(unknown.status, 404);
  assert.match(unknown.body.error, /no_such_tool/);
  const bad = await fetch(`${s.base}/api/agent/call`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{nope" });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).code, "invalid_json");
  const invalid = await s.agent("add_entry", {});
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, "invalid_arguments");
  assert.ok(Array.isArray(invalid.body.issues));
});

test("a failing tool keeps its status and candidates", async () => {
  const out = await s.agent("add_entry", { amount: "12,50", account: "nope" });
  assert.equal(out.status, 400);
  assert.ok(Array.isArray(out.body.candidates));
});
