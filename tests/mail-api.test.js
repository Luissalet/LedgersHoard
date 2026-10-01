import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "./helpers.js";
import { MAIL } from "./mail-fixtures.js";
import { installFakeSource, captureNotifications } from "./mail-helpers.js";
import { db } from "../server/db.js";
import { TOOLS, AGENT_INSTRUCTIONS } from "../server/agent-tools.js";
import { createMailScheduler } from "../server/mail-scheduler.js";
import { buildToastPs1, showToast, setNotifyBackends, resetNotifyBackends, xmlEscape } from "../server/notifications.js";
import { mailSettings } from "../server/mail-settings.js";
import { setMailSource } from "../server/mail-source.js";

let s;
let sink;
let account;
const msg = (name, patch = {}) => ({ ...MAIL[name], ...patch });
const wipe = () => {
  for (const table of ["entries", "mail_messages", "subscriptions", "mail_runs", "notifications"]) db().exec(`DELETE FROM ${table}`);
};

before(async () => {
  s = await bootServer();
  sink = captureNotifications();
  account = (await s.agent("upsert_account", { name: "Banco Ficticio", opening_balance: "1.000" })).body.account;
});
after(async () => { sink.restore(); await s.stop(); });
beforeEach(() => { wipe(); sink.events.length = 0; });

test("the new tools are in the catalogue with synonyms, short headlines and correct annotations", async () => {
  const r = await s.call("GET", "/api/agent/tools");
  const tools = Object.fromEntries(r.body.tools.map((t) => [t.name, t]));
  const names = ["mail_status", "mail_scan", "mail_review", "mail_accept", "mail_ignore", "mail_undo", "mail_reset", "mail_paste", "subscriptions_list", "subscription_update", "subscriptions_upcoming", "mail_spending", "ledger_notifications"];
  for (const name of names) {
    const t = tools[name];
    assert.ok(t, name);
    assert.match(t.description, /\nSinónimos: .+/, name);
    assert.ok(t.description.split("\n", 1)[0].length <= 110, name);
    assert.equal(t.inputSchema.type, "object");
  }
  for (const name of ["mail_status", "mail_review", "subscriptions_upcoming", "mail_spending", "ledger_notifications"]) assert.equal(tools[name].annotations.readOnlyHint, true, name);
  for (const name of ["mail_scan", "mail_accept", "mail_paste", "subscription_update"]) assert.equal(tools[name].annotations.readOnlyHint, false, name);
  assert.equal(tools.mail_undo.annotations.destructiveHint, true);
  assert.equal(tools.mail_scan.annotations.openWorldHint, true);
  assert.equal(tools.mail_status.annotations.openWorldHint, true);
  assert.equal(tools.list_accounts.annotations.openWorldHint, false);
  assert.equal(TOOLS.length, 38);
  assert.equal(tools.mail_reset.annotations.destructiveHint, true);
  assert.match(AGENT_INSTRUCTIONS, /untrusted/);
  assert.match(AGENT_INSTRUCTIONS, /never invent an amount, date or merchant/);
  assert.match(AGENT_INSTRUCTIONS, /date, amount, account, category and merchant/);
  assert.match(AGENT_INSTRUCTIONS, /mail_undo deletes the entry/);
});

test("mail tools need the token like every other tool", async () => {
  const noToken = await s.call("POST", "/api/agent/call", { name: "mail_scan", arguments: {} });
  assert.equal(noToken.status, 401);
});

test("mail_scan through the agent route records payments and reports them, then mail_review/mail_accept/mail_undo", async () => {
  installFakeSource([msg("netflix"), msg("english"), msg("newsletter")]);
  const scan = await s.agent("mail_scan", {});
  assert.equal(scan.status, 200, JSON.stringify(scan.body));
  assert.equal(scan.body.run.recorded, 1);
  assert.equal(scan.body.recorded.length, 1);
  assert.deepEqual([scan.body.recorded[0].merchant, scan.body.recorded[0].amount, scan.body.recorded[0].date], ["Netflix", "12,99 €", "2026-10-05"]);
  assert.equal(scan.body.recorded[0].entry.account, "Banco Ficticio");
  assert.equal(scan.body.recorded[0].entry.category, "Suscripciones");
  assert.equal(scan.body.review_pending, 1);
  assert.match(scan.body.note, /no instrucciones/);

  const review = await s.agent("mail_review", {});
  assert.equal(review.body.messages.length, 1);
  assert.match(review.body.messages[0].review_reasons.join(" "), /divisa USD/);
  const id = review.body.messages[0].message_id;

  const accepted = await s.agent("mail_accept", { message_id: id, amount: "1.100,00", account: "Banco", category: "Ocio" });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.entry.amount_cents, -110000);
  assert.equal(accepted.body.entry.category_name, "Ocio");
  assert.equal((await s.agent("mail_review", {})).body.messages.length, 0);

  const noConfirm = await s.agent("mail_undo", { message_id: id });
  assert.equal(noConfirm.status, 400);
  assert.match(noConfirm.body.error, /confirm/);
  const undone = await s.agent("mail_undo", { message_id: id, confirm: true });
  assert.equal(undone.status, 200);
  assert.equal(undone.body.deleted.amount_cents, -110000);
  assert.equal((await s.call("GET", "/api/entries?source=mail")).body.total, 1, "only the Netflix entry is left");

  const missing = await s.agent("mail_accept", { message_id: "<nope@test>" });
  assert.equal(missing.status, 404);
  const ignored = await s.agent("mail_ignore", { message_id: "<m-netflix-1@test>" });
  assert.equal(ignored.status, 409, "a recorded mail is undone, not ignored");
});

test("mail_scan: a scan in progress answers 409, a failed read answers the error in the run", async () => {
  installFakeSource([msg("netflix")], { delay: 120 });
  const first = s.agent("mail_scan", {});
  await new Promise((r) => setTimeout(r, 30));
  const second = await s.agent("mail_scan", {});
  assert.equal(second.status, 409);
  assert.equal((await first).status, 200);
  installFakeSource([], { ok: false, error: "sin cuenta de correo" });
  const failed = await s.agent("mail_scan", {});
  assert.equal(failed.body.run.ok, false);
  assert.match(failed.body.run.error, /sin cuenta/);
});

test("mail_paste, mail_spending, subscriptions and notifications tools", async () => {
  const pasted = await s.agent("mail_paste", { subject: "Recibo de Spotify Premium", from: "Spotify <no-reply@spotify.com>", text: "Gracias por tu pago. Plan mensual.\nImporte total: 11,99 €\nFecha de pago: 12/10/2026" });
  assert.equal(pasted.status, 200, JSON.stringify(pasted.body));
  assert.equal(pasted.body.state, "recorded");
  assert.equal(pasted.body.entry.date, "2026-10-12");
  const spending = await s.agent("mail_spending", { month: "2026-10" });
  assert.equal(spending.body.count, 1);
  assert.equal(spending.body.spent, "11,99 €");
  assert.equal((await s.agent("mail_spending", { month: "mal" })).status, 400);

  const list = await s.agent("subscriptions_list", {});
  assert.equal(list.body.subscriptions.length, 1);
  assert.equal(list.body.subscriptions[0].merchant, "Spotify");
  assert.equal(list.body.totals[0].monthly_text, "11,99 €");
  assert.equal(list.body.totals[0].yearly_text, "143,88 €");
  const id = list.body.subscriptions[0].id;

  const up = await s.agent("subscriptions_upcoming", { days: 365 });
  assert.equal(up.body.upcoming[0].merchant, "Spotify");
  assert.equal(up.body.upcoming[0].date, "2026-11-12");

  const updated = await s.agent("subscription_update", { ref: "spotify", status: "cancelled" });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.subscription.status, "cancelled");
  assert.equal(updated.body.subscription.next_charge_date, null);
  assert.equal((await s.agent("subscriptions_list", {})).body.totals.length, 0, "cancelled stops counting");
  assert.equal((await s.agent("subscriptions_list", { status: "cancelled" })).body.subscriptions.length, 1);
  const edited = await s.agent("subscription_update", { ref: id, status: "active", amount: "9,99", period: "yearly", category: "Ocio", next_charge_date: "2027-01-05", notes: "plan familiar" });
  assert.equal(edited.body.subscription.amount_cents, 999);
  assert.equal(edited.body.subscription.period, "yearly");
  assert.equal(edited.body.subscription.next_charge_date, "2027-01-05");
  assert.equal((await s.agent("subscription_update", { ref: "nada", status: "paused" })).status, 404);
  assert.equal((await s.agent("subscription_update", { ref: id, next_charge_date: "31/02/2027" })).status, 400);
  assert.equal((await s.agent("subscription_update", { ref: id, category: "Inventada" })).status, 400);

  const notes = await s.agent("ledger_notifications", {});
  assert.ok(notes.body.notifications.some((n) => n.kind === "mail.recorded"));
  assert.ok(notes.body.notifications.some((n) => n.kind === "subscription.new"));
  assert.equal((await s.agent("ledger_notifications", { kind: "payment.failed" })).body.notifications.length, 0);
});

test("subscriptions_list can detect subscriptions from steady monthly entries", async () => {
  for (const month of ["05", "06", "07", "08", "09"]) await s.call("POST", "/api/entries", { date: `2026-${month}-10`, amount_cents: -899, account_id: account.id, counterparty: "Revista Digital Ejemplo" });
  assert.equal((await s.agent("subscriptions_list", {})).body.subscriptions.length, 0);
  const found = await s.agent("subscriptions_list", { detect_from_entries: true });
  assert.equal(found.body.created_from_entries.length, 1);
  assert.equal(found.body.subscriptions[0].source, "recurring");
});

test("mail_status through the tool and the routes", async () => {
  const source = installFakeSource([]);
  const tool = await s.agent("mail_status", {});
  assert.equal(tool.status, 200);
  assert.equal(tool.body.source.ok, true);
  assert.equal(tool.body.settings.enabled, true);
  assert.equal(tool.body.settings.interval_min, 15);
  assert.equal(tool.body.effective_account.name, "Banco Ficticio");
  assert.equal((await s.agent("mail_status", { check_source: false })).body.source, undefined);
  const route = await s.call("GET", "/api/mail/status?source=1");
  assert.equal(route.body.source.faustus_dir, "/fake/faustus");
  assert.equal(route.body.counts.review, 0);
  assert.equal(source.calls, 0, "status never scans");
});

test("settings route: defaults, validation, and the account is stored as an id", async () => {
  const defaults = (await s.call("GET", "/api/mail/settings")).body;
  assert.deepEqual(defaults, { enabled: true, auto_record: true, account: "", interval_min: 15, first_days: 62, window_days: 14, min_confidence: 70, review_above: 500, toast: true, hub: true, quiet_history: true, faustus_dir: "", faustus_owner: "" });
  const put = await s.call("PUT", "/api/mail/settings", { interval_min: 30, auto_record: false, account: "Banco", faustus_owner: "luis", toast: false });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal(put.body.interval_min, 30);
  assert.equal(put.body.auto_record, false);
  assert.equal(put.body.account, account.id);
  assert.equal(put.body.toast, false);
  assert.equal((await s.call("PUT", "/api/mail/settings", { interval_min: 1 })).status, 400);
  assert.equal((await s.call("PUT", "/api/mail/settings", { min_confidence: 120 })).status, 400);
  assert.equal((await s.call("PUT", "/api/mail/settings", { account: "No existe" })).status, 400);
  assert.equal((await s.call("PUT", "/api/mail/settings", { cosa: 1 })).status, 400);
  await s.call("PUT", "/api/mail/settings", { interval_min: 15, auto_record: true, account: "", faustus_owner: "", toast: true });
  assert.equal(mailSettings().auto_record, true);
});

test("routes: scan, messages, review, recorded, accept, ignore, undo, paste, spending, runs, notifications", async () => {
  await s.call("PUT", "/api/mail/settings", { auto_record: false });
  installFakeSource([msg("netflix"), msg("amazon"), msg("renewal")]);
  const scan = await s.call("POST", "/api/mail/scan", { since_days: 30 });
  assert.equal(scan.status, 200);
  assert.deepEqual([scan.body.scanned, scan.body.review, scan.body.recorded], [3, 2, 0]);
  assert.equal((await s.call("POST", "/api/mail/scan", { since_days: 0 })).status, 400);
  const review = (await s.call("GET", "/api/mail/review")).body.messages;
  assert.equal(review.length, 2);
  assert.equal((await s.call("GET", "/api/mail/messages?kind=upcoming")).body.messages.length, 1);
  assert.equal((await s.call("GET", "/api/mail/messages?state=review&limit=1")).body.messages.length, 1);

  const accept = await s.call("POST", "/api/mail/accept", { message_id: "<m-netflix-1@test>", category: "Suscripciones" });
  assert.equal(accept.status, 200, JSON.stringify(accept.body));
  assert.equal(accept.body.entry.amount_cents, -1299);
  assert.equal((await s.call("POST", "/api/mail/accept", {})).status, 400);
  assert.equal((await s.call("POST", "/api/mail/accept", { message_id: "<nope@test>" })).status, 404);
  assert.equal((await s.call("POST", "/api/mail/ignore", { message_id: "<m-amazon-1@test>" })).body.mail.state, "ignored");
  const recorded = (await s.call("GET", "/api/mail/recorded?month=2026-10")).body.messages;
  assert.deepEqual(recorded.map((m) => m.merchant), ["Netflix"]);
  assert.equal(recorded[0].entry.category, "Suscripciones");
  assert.equal((await s.call("GET", "/api/mail/recorded?month=2026-13")).status, 400);

  assert.equal((await s.call("POST", "/api/mail/undo", { message_id: "<m-netflix-1@test>" })).status, 400);
  const undo = await s.call("POST", "/api/mail/undo", { message_id: "<m-netflix-1@test>", confirm: true });
  assert.equal(undo.body.undone, true);
  assert.equal((await s.call("GET", "/api/entries")).body.total, 0);

  const paste = await s.call("POST", "/api/mail/paste", { subject: "Recibo", from: "Tienda Ejemplo <pedidos@tiendaejemplo.test>", text: "Gracias por tu compra\nTotal: 20,00 €" });
  assert.equal(paste.status, 200);
  assert.equal((await s.call("POST", "/api/mail/paste", { text: "" })).status, 400);
  assert.equal((await s.call("GET", "/api/mail/spending?month=2026-10")).status, 200);
  assert.ok((await s.call("GET", "/api/mail/runs")).body.runs.length >= 1);
  assert.ok(Array.isArray((await s.call("GET", "/api/mail/notifications")).body.notifications));
  await s.call("PUT", "/api/mail/settings", { auto_record: true });
});

test("subscription routes: list with totals, create, patch, delete, detect", async () => {
  const created = await s.call("POST", "/api/subscriptions", { merchant: "Revista Ejemplo", amount: "7,50", period: "monthly", next_charge_date: "2026-11-01" });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.amount_cents, 750);
  assert.equal(created.body.source, "manual");
  assert.equal((await s.call("POST", "/api/subscriptions", { merchant: "revista ejemplo", amount: "1" })).status, 409);
  assert.equal((await s.call("POST", "/api/subscriptions", { merchant: "X", amount: "abc" })).status, 400);
  const list = (await s.call("GET", "/api/subscriptions")).body;
  assert.equal(list.subscriptions.length, 1);
  assert.equal(list.totals[0].monthly_cents, 750);
  assert.equal(list.subscriptions[0].amount_text, "7,50 €");
  const patched = await s.call("PATCH", `/api/subscriptions/${created.body.id}`, { status: "paused", amount: "8,00" });
  assert.equal(patched.body.status, "paused");
  assert.equal(patched.body.amount_cents, 800);
  assert.equal((await s.call("PATCH", "/api/subscriptions/nope", { status: "paused" })).status, 404);
  assert.equal((await s.call("PATCH", `/api/subscriptions/${created.body.id}`, { status: "inventado" })).status, 400);
  assert.equal((await s.call("GET", "/api/subscriptions/upcoming?days=60")).body.upcoming.length, 0, "paused ones do not appear");
  assert.equal((await s.call("POST", "/api/subscriptions/detect", {})).status, 200);
  assert.equal((await s.call("DELETE", `/api/subscriptions/${created.body.id}`)).body.ok, true);
});

test("the CSV import route reports matched_mail", async () => {
  installFakeSource([msg("netflix")]);
  await s.agent("mail_scan", {});
  const csv = "Fecha;Concepto;Importe\n06/10/2026;COMPRA TARJ. NETFLIX.COM 4455;-12,99\n";
  const preview = await s.call("POST", "/api/imports/preview", { csv, account_id: account.id });
  assert.equal(preview.body.rows_matched_mail, 1);
  const commit = await s.call("POST", "/api/imports/commit", { csv, account_id: account.id });
  assert.equal(commit.body.matched_mail, 1);
  assert.equal(commit.body.rows_added, 0);
  assert.equal((await s.call("GET", "/api/entries")).body.total, 1);
  const via = await s.agent("import_csv_commit", { csv, account: "Banco" });
  assert.equal(via.body.matched_mail, 0);
  assert.equal(via.body.rows_skipped, 1);
});

test("scheduler: first scan after 30 s, then every interval; one at a time; survives errors; off when disabled", async () => {
  const timers = [];
  let now = 1_000_000;
  const setTimer = (fn, ms) => { const t = { fn, ms, cleared: false, unref() {} }; timers.push(t); return t; };
  const clearTimer = (t) => { t.cleared = true; };
  let calls = 0;
  let release = null;
  let enabled = true;
  let interval = 15;
  let fail = false;
  const scan = async () => {
    calls++;
    if (fail) throw new Error("boom");
    await new Promise((resolve) => { release = resolve; });
  };
  const scheduler = createMailScheduler({ scan, settings: () => ({ enabled, interval_min: interval }), setTimer, clearTimer, clock: () => now, firstDelayMs: 30_000 });
  scheduler.start();
  scheduler.start();
  assert.equal(timers.length, 1, "starting twice does not double the timer");
  assert.equal(timers[0].ms, 30_000);
  const { runtime } = await import("../server/mail-runtime.js");
  assert.equal(runtime.nextScanTs, Math.floor((now + 30_000) / 1000));
  const running = timers[0].fn();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls, 1);
  // a manual tick while a scan is running starts no second scan
  const overlapping = scheduler.tick();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls, 1, "single flight");
  release();
  await running;
  await overlapping;
  assert.equal(timers.at(-1).ms, 15 * 60_000, "next scan after the interval");
  // the interval setting is re-read each time
  interval = 30;
  const t2 = timers.at(-1);
  const p2 = t2.fn();
  await new Promise((r) => setTimeout(r, 10));
  release();
  await p2;
  assert.equal(timers.at(-1).ms, 30 * 60_000);
  // errors never stop the loop
  fail = true;
  await timers.at(-1).fn();
  assert.equal(timers.at(-1).ms, 30 * 60_000);
  assert.equal(scheduler.running, true);
  // disabled: no scan, still scheduled
  fail = false; enabled = false;
  const before = calls;
  await timers.at(-1).fn();
  assert.equal(calls, before);
  assert.equal(timers.at(-1).cleared, false);
  scheduler.stop();
  assert.equal(scheduler.running, false);
  assert.equal(runtime.nextScanTs, null);
  assert.equal(timers.at(-1).cleared, true);
  const afterStop = timers.length;
  await timers.at(-1).fn();
  assert.equal(timers.length, afterStop, "a stopped scheduler does not reschedule");
});

test("createApp starts the scheduler only when asked", async () => {
  const { createApp } = await import("../server/app.js");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  // the database is a process-wide singleton, so reuse the open one: createApp returns the scheduler object
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-sched-"));
  const { scheduler } = createApp({ dataDir: dir, serveStatic: false });
  assert.equal(scheduler.running, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("toast: PowerShell script with BOM, escaped text, hidden window, only on Windows", async () => {
  sink.restore();
  const ran = [];
  const files = [];
  setNotifyBackends({
    platform: () => "win32",
    powershell: async (exe, args, options) => {
      const file = args[args.indexOf("-File") + 1];
      files.push({ file, bytes: (await import("node:fs")).readFileSync(file) });
      ran.push({ exe, args, options });
      return { code: 0 };
    },
  });
  try {
    assert.equal(await showToast('Netflix <12,99 €> & "más"', "Pago apuntado\ncon tilde: ñ"), "");
    assert.equal(ran.length, 1);
    assert.equal(ran[0].exe, "powershell");
    for (const a of ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File"]) assert.ok(ran[0].args.includes(a), a);
    assert.equal(ran[0].options.windowsHide, true);
    const bytes = files[0].bytes;
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], "UTF-8 BOM so Windows PowerShell 5.1 reads accents");
    const text = bytes.toString("utf8");
    assert.match(text, /ToastNotificationManager/);
    assert.match(text, /&lt;12,99 €&gt; &amp; &quot;más&quot;/);
    assert.equal((await import("node:fs")).existsSync(files[0].file), false, "temp script removed");
    setNotifyBackends({ powershell: async () => ({ code: 1 }) });
    assert.match(await showToast("a", "b"), /powershell 1/);
    setNotifyBackends({ platform: () => "linux" });
    assert.equal(await showToast("a", "b"), "no es Windows");
  } finally {
    resetNotifyBackends();
    sink = captureNotifications();
  }
});

test("toast script building: launch url only for http(s), text limits, control characters stripped", () => {
  const ps1 = buildToastPs1("T".repeat(300), "B".repeat(500), "http://127.0.0.1:5180/#/correo");
  assert.match(ps1, /activationType="protocol" launch="http:\/\/127\.0\.0\.1:5180\/#\/correo"/);
  assert.ok(ps1.includes("T".repeat(120)) && !ps1.includes("T".repeat(121)));
  assert.ok(ps1.includes("B".repeat(300)) && !ps1.includes("B".repeat(301)));
  assert.equal(buildToastPs1("a", "b", "javascript:alert(1)").includes("launch="), false);
  assert.equal(xmlEscape("a\u0000b\u0007c"), "abc");
});

test("the real helper never receives the database or anything else from the app", async () => {
  // the default source is replaced in these tests; make sure restoring it does not break the module
  setMailSource(null);
  const { mailSource } = await import("../server/mail-source.js");
  assert.equal(typeof mailSource().scan, "function");
  installFakeSource([]);
});
