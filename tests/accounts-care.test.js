// Renewal reminders, extra charges and charges after cancelling, budget alerts, the month comparison, OFX statements and
// the match with entries typed by hand, the subscription tools and the mail review hints.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "./helpers.js";
import { installFakeSource, captureNotifications } from "./mail-helpers.js";
import * as engine from "../server/mail-engine.js";
import * as subs from "../server/subscriptions.js";
import { sweepBudgets, sweepAll, updateAlertSettings, alertSettings } from "../server/alerts.js";
import { monthCompare } from "../server/reports.js";
import { parseOfx, looksLikeOfx } from "../server/ofx.js";
import { previewImport, commitImport } from "../server/imports.js";
import { parseMail } from "../server/mail-parse.js";
import { updateMailSettings } from "../server/mail-settings.js";
import { db } from "../server/db.js";
import { createEntry, listEntries, getEntry } from "../server/entries.js";
import { createAccount } from "../server/accounts.js";
import { createCategory } from "../server/categories.js";
import { listNotifications } from "../server/notifications.js";
import { today, addDays } from "../server/dates.js";

let s;
let sink;
let account;
const at = (iso) => Math.floor(Date.parse(`${iso}T12:00:00Z`) / 1000);
const kinds = () => listNotifications({ limit: 200 }).map((n) => n.kind);
const wipe = () => {
  for (const table of ["entries", "mail_messages", "subscriptions", "mail_runs", "notifications", "imports"]) db().exec(`DELETE FROM ${table}`);
  db().exec("DELETE FROM categories WHERE name LIKE 'Prueba%'");
  db().exec("DELETE FROM settings WHERE key LIKE 'alerts.%'");
  updateMailSettings({ account: "", auto_record: true, min_confidence: 70, toast: true, hub: true, quiet_history: false });
};

before(async () => {
  s = await bootServer();
  sink = captureNotifications();
  account = createAccount({ name: "Banco Ficticio", opening_balance: 100000 });
});
after(async () => { sink.restore(); await s.stop(); });
beforeEach(() => { wipe(); sink.events.length = 0; });

// ------------------------------------------------------------------ subscriptions
test("a passed next charge date is worked forward in the upcoming list and marked estimated", () => {
  subs.createSubscription({ merchant: "Streaming Demo", amount_cents: 999, period: "monthly", next_charge_date: "2026-09-20" });
  const items = subs.upcoming({ days: 30, from: "2026-11-10" });
  assert.equal(items.length, 1);
  assert.equal(items[0].date, "2026-11-20");
  assert.equal(items[0].estimated, true);
  const fresh = subs.upcoming({ days: 30, from: "2026-09-01" });
  assert.equal(fresh[0].date, "2026-09-20");
  assert.equal(fresh[0].estimated, false);
});

test("a second charge inside the same monthly cycle is an extra: no price change, no new date, no alert", async () => {
  await subs.observeCharge({ merchant: "Nube Demo", amount_cents: 9000, date: "2026-09-30", period: "monthly", hint: true });
  await subs.observeCharge({ merchant: "Nube Demo", amount_cents: 1000, date: "2026-10-02", hint: true });
  let sub = subs.findSubscriptionByKey(subs.listSubscriptions()[0].merchant_key);
  assert.equal(sub.amount_cents, 9000);
  assert.equal(sub.next_charge_date, "2026-10-30");
  assert.equal(sub.price_history.at(-1).extra, true);
  assert.ok(!kinds().includes("subscription.price"));
  // the real renewal a month later does move the price
  await subs.observeCharge({ merchant: "Nube Demo", amount_cents: 18000, date: "2026-10-30", hint: true });
  sub = subs.getSubscription(sub.id);
  assert.equal(sub.amount_cents, 18000);
  assert.equal(sub.next_charge_date, "2026-11-30");
  assert.ok(kinds().includes("subscription.price"));
});

test("a charge for a cancelled subscription raises a high alert and the subscription is active again", async () => {
  const created = await subs.observeCharge({ merchant: "Música Demo", amount_cents: 1099, date: "2026-09-12", period: "monthly", hint: true });
  subs.updateSubscription(created.id, { status: "cancelled" });
  await subs.observeCharge({ merchant: "Música Demo", amount_cents: 1099, date: "2026-10-12", hint: true });
  const alert = listNotifications({ kind: "subscription.charged_after_cancel" })[0];
  assert.ok(alert, "alert stored");
  assert.equal(alert.severity, "high");
  assert.equal(subs.getSubscription(created.id).status, "active");
  assert.ok(sink.events.some((e) => e.type === "ledger.subscription.charged_after_cancel"));
});

test("a reminder before every renewal, monthly and yearly, once, with the days set in the alert settings", async () => {
  subs.createSubscription({ merchant: "Mensual Demo", amount_cents: 499, period: "monthly", next_charge_date: "2026-11-13" });
  subs.createSubscription({ merchant: "Anual Demo", amount_cents: 5999, period: "yearly", next_charge_date: "2026-11-16" });
  subs.createSubscription({ merchant: "Lejana Demo", amount_cents: 300, period: "monthly", next_charge_date: "2026-11-25" });
  assert.equal(await sweepAll("2026-11-10"), 2);
  const titles = listNotifications({ kind: "subscription.upcoming" }).map((n) => n.title).sort();
  assert.deepEqual(titles, ["Anual Demo se renueva en 6 días", "Mensual Demo se renueva en 3 días"]);
  assert.match(listNotifications({ kind: "subscription.upcoming" })[0].body, /cancélala antes/);
  assert.equal(await sweepAll("2026-11-10"), 0, "once per renewal");
  wipe();
  updateAlertSettings({ renew_days: 0, renew_days_yearly: 0 });
  subs.createSubscription({ merchant: "Mensual Demo", amount_cents: 499, period: "monthly", next_charge_date: "2026-11-11" });
  assert.equal(await sweepAll("2026-11-10"), 0, "0 turns the reminders off");
});

// ------------------------------------------------------------------ budgets
test("budget alerts: a warning at the set percentage and another when it is passed, once each per month", async () => {
  const cat = createCategory({ name: "Prueba Comida", kind: "expense", monthly_budget: 10000 });
  createEntry({ date: "2026-10-03", amount_cents: -8200, account_id: account.id, category_id: cat.id, counterparty: "Mercado" });
  assert.equal(await sweepBudgets("2026-10-15"), 1);
  assert.equal(listNotifications({ kind: "budget.warning" })[0].title, "Prueba Comida: llevas el 82 % del presupuesto");
  assert.equal(await sweepBudgets("2026-10-15"), 0);
  createEntry({ date: "2026-10-09", amount_cents: -2500, account_id: account.id, category_id: cat.id, counterparty: "Mercado" });
  assert.equal(await sweepBudgets("2026-10-15"), 1);
  const over = listNotifications({ kind: "budget.over" })[0];
  assert.equal(over.title, "Presupuesto de Prueba Comida superado");
  assert.match(over.body, /107,00 € de 100,00 €/);
  assert.ok(sink.events.some((e) => e.type === "ledger.budget.over" && e.data.category === "Prueba Comida"));
  updateAlertSettings({ budget: false });
  createCategory({ name: "Prueba Ocio", kind: "expense", monthly_budget: 100 });
  createEntry({ date: "2026-10-09", amount_cents: -500, account_id: account.id, counterparty: "Cine", category_id: null });
  assert.equal(await sweepBudgets("2026-10-15"), 0);
});

test("an entry saved through the API raises its budget alert by itself", async () => {
  const cat = createCategory({ name: "Prueba Casa", kind: "expense", monthly_budget: 1000 });
  const r = await s.call("POST", "/api/entries", { date: today(), amount: "-12,00", account_id: account.id, category_id: cat.id, counterparty: "Ferretería" });
  assert.equal(r.status, 201);
  await new Promise((resolve) => setTimeout(resolve, 1300));
  assert.ok(listNotifications({ kind: "budget.over" }).some((n) => n.payload.category_id === cat.id));
});

test("alert settings over HTTP and MCP", async () => {
  assert.deepEqual((await s.call("GET", "/api/alerts/settings")).body, { renew_days: 3, renew_days_yearly: 7, budget: true, budget_warn_pct: 80 });
  assert.equal((await s.call("PUT", "/api/alerts/settings", { renew_days: 5 })).body.renew_days, 5);
  assert.equal((await s.call("PUT", "/api/alerts/settings", { renew_days: 99 })).status, 400);
  const out = await s.agent("alert_settings", { budget_warn_pct: 90 });
  assert.equal(out.status, 200);
  assert.equal(alertSettings().budget_warn_pct, 90);
  assert.equal((await s.agent("alert_settings", {})).body.settings.renew_days, 5);
});

// ------------------------------------------------------------------ month comparison
test("month comparison: previous month, 3-month average and, for the month in progress, the same day of the month before", async () => {
  const cat = createCategory({ name: "Prueba Super", kind: "expense" });
  for (const [date, cents] of [["2026-07-05", -3000], ["2026-08-05", -6000], ["2026-09-05", -9000], ["2026-09-25", -1000], ["2026-10-04", -4000]]) {
    createEntry({ date, amount_cents: cents, account_id: account.id, category_id: cat.id, counterparty: "Super" });
  }
  const done = monthCompare("2026-09", "2026-11-10");
  assert.equal(done.in_progress, false);
  assert.equal(done.totals.expense, 10000);
  assert.equal(done.previous.expense, 6000);
  const line = done.categories.find((c) => c.id === cat.id);
  assert.equal(line.delta_previous, 4000);
  assert.equal(line.pct_previous, 67);
  const live = monthCompare("2026-10", "2026-10-10");
  assert.equal(live.in_progress, true);
  assert.equal(live.previous_same_day.expense, 9000, "September up to day 10");
  assert.equal(live.average.expense, Math.round((6000 + 10000 + 3000) / 3));
  assert.match(live.verdict, /a estas alturas/);
  const api = await s.call("GET", "/api/reports/compare?month=2026-09");
  assert.equal(api.status, 200);
  const tool = await s.agent("month_compare", { month: "2026-09" });
  assert.equal(tool.body.totals.expense, 10000);
});

// ------------------------------------------------------------------ OFX and manual entries
const OFX = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EUR<BANKACCTFROM><ACCTID>ES00TEST</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261003120000<TRNAMT>-42.10<FITID>A1<NAME>SUPERMERCADO EJEMPLO<MEMO>COMPRA TARJETA</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261005<TRNAMT>1500,00<FITID>A2<NAME>NOMINA EMPRESA FICTICIA</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261007<TRNAMT>-63.25<FITID>A3<NAME>RECIBO LUZ &amp; GAS</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

test("an OFX statement is read, imported once and joins an entry typed by hand", () => {
  assert.equal(looksLikeOfx(OFX), true);
  assert.equal(looksLikeOfx("Fecha;Importe\n01/01/2026;3"), false);
  const parsed = parseOfx(OFX);
  assert.equal(parsed.currency, "EUR");
  assert.deepEqual(parsed.transactions.map((t) => [t.date, t.amount, t.payee]), [["2026-10-03", "-42.10", "SUPERMERCADO EJEMPLO"], ["2026-10-05", "1500.00", "NOMINA EMPRESA FICTICIA"], ["2026-10-07", "-63.25", "RECIBO LUZ & GAS"]]);
  const typed = createEntry({ date: "2026-10-06", amount_cents: -6325, account_id: account.id, counterparty: "Luz", note: "a mano" });
  const preview = previewImport({ csv: OFX, account_id: account.id });
  assert.equal(preview.format, "ofx");
  assert.equal(preview.rows_valid, 3);
  assert.equal(preview.rows_new, 2);
  assert.equal(preview.rows_matched_manual, 1);
  assert.equal(preview.sample[2].matched_manual, true);
  const out = commitImport({ csv: OFX, account_id: account.id, filename: "extracto.ofx" });
  assert.equal(out.rows_added, 2);
  assert.equal(out.matched_manual, 1);
  const joined = getEntry(typed.id);
  assert.equal(joined.date, "2026-10-07", "the bank date wins");
  assert.equal(joined.counterparty, "Luz", "the typed concept stays");
  assert.match(joined.note, /banco: /);
  assert.equal(listEntries({ limit: 50 }).items.length, 3, "one entry per payment");
  const again = commitImport({ csv: OFX, account_id: account.id });
  assert.equal(again.rows_added, 0);
  assert.equal(again.rows_skipped, 3);
});

test("a CSV row joins a typed entry only when it is unambiguous", () => {
  createEntry({ date: "2026-10-03", amount_cents: -1000, account_id: account.id, counterparty: "Panadería" });
  createEntry({ date: "2026-10-04", amount_cents: -1000, account_id: account.id, counterparty: "Quiosco" });
  createEntry({ date: "2026-10-05", amount_cents: -1000, account_id: account.id, counterparty: "Kiosko" });
  const csv = "Fecha;Concepto;Importe\n03/10/2026;COMPRA PANADERIA;-10,00\n05/10/2026;OTRA COSA;-10,00\n";
  const p = previewImport({ csv, account_id: account.id });
  assert.equal(p.rows_matched_manual, 1, "the panadería row matches by name; the second is ambiguous between the rest");
  assert.equal(p.sample[0].matched_manual, true);
});

// ------------------------------------------------------------------ subscription tools
test("subscription tools: create with a trial, update every field, cancel, and delete only with confirm", async () => {
  const created = await s.agent("subscription_create", { merchant: "Vídeo Demo", amount: "7,99", trial_end_date: "2026-12-01" });
  assert.equal(created.status, 200);
  const sub = created.body.subscription;
  assert.equal(sub.status, "trial");
  assert.equal(sub.trial_end_date, "2026-12-01");
  const upd = await s.agent("subscription_update", { ref: "Vídeo Demo", merchant: "Vídeo Demo Plus", amount: "9,99", account: "Banco Ficticio", next_charge_date: "2026-12-01", trial_end_date: null, status: "active" });
  assert.equal(upd.status, 200);
  const after = upd.body.subscription;
  assert.equal(after.merchant, "Vídeo Demo Plus");
  assert.equal(after.amount_cents, 999);
  assert.equal(after.account_id, account.id);
  assert.equal(after.trial_end_date, null);
  assert.equal(upd.body.before.amount_cents, 799);
  const nothing = await s.agent("subscription_update", { ref: "Vídeo Demo Plus" });
  assert.equal(nothing.status, 400);
  const cancel = await s.agent("subscription_update", { ref: "Vídeo Demo Plus", status: "cancelled" });
  assert.equal(cancel.body.subscription.status, "cancelled");
  assert.equal(cancel.body.subscription.next_charge, null);
  const refused = await s.agent("subscription_delete", { ref: "Vídeo Demo Plus" });
  assert.equal(refused.status, 400);
  assert.ok(subs.getSubscription(sub.id));
  const del = await s.agent("subscription_delete", { ref: "Vídeo Demo Plus", confirm: true });
  assert.equal(del.body.deleted, true);
  assert.equal(subs.getSubscription(sub.id), null);
});

// ------------------------------------------------------------------ mail
test("order numbers the family table misses: «pedido con número N» and «Tu pedido Marca N» are one order", async () => {
  const a = parseMail({ subject: "Tu pedido TiendaDemo 336650001 está en marcha", from_name: "TiendaDemo", from_address: "noreply@tiendademo.test", text: "Gracias por tu compra. Tu pedido con número 336650001 ha salido.", ts: at("2026-11-09") });
  const b = parseMail({ subject: "Tu factura simplificada TiendaDemo 336650001", from_name: "TiendaDemo", from_address: "noreply@tiendademo.test", text: "Te adjuntamos la factura simplificada de tu pedido 336650001.", ts: at("2026-11-09") });
  assert.equal(a.order_ref, "336650001");
  assert.equal(b.order_ref, "336650001");
  installFakeSource([
    { message_id: "<o1@test>", subject: "Tu pedido TiendaDemo 336650001 está en marcha", from_name: "TiendaDemo", from_address: "noreply@tiendademo.test", text: "Gracias por tu compra. Tu pedido con número 336650001 ha salido.", ts: at("2026-11-09") },
    { message_id: "<o2@test>", subject: "Tu factura simplificada TiendaDemo 336650001", from_name: "TiendaDemo", from_address: "noreply@tiendademo.test", text: "Te adjuntamos la factura simplificada de tu pedido 336650001.", ts: at("2026-11-09") },
  ]);
  await engine.scanMail({ trigger: "test" });
  assert.equal(engine.reviewQueue().length, 1, "the invoice joins the order instead of a second review item");
});

test("a sales mail about the bill with no amount is not a payment", () => {
  const f = parseMail({ subject: "¿Ahorrar en tu factura? ¡Ni truco ni trato!", from_name: "Teleco Demo", from_address: "clientes@info.telecodemo.test", text: "Hola, hay sustos que se pueden evitar, como pagar de más en tu factura. Combina tu tarifa.", ts: at("2026-10-22") });
  assert.equal(f.kind, "noise");
});

test("a short order number with the same amount a few days later is the same order", async () => {
  const receipt = { message_id: "<n1@test>", subject: "Your SHOPDEMO order receipt from 09/10/2026", from_name: "SHOPDEMO", from_address: "orders@m.shopdemo.test", text: "Thank you for your order.\nOrder #51860 ( 09/10/2026 )\nSwitch X ×1 958.00 €\nShipping 29.00 €\nTotal: 987.00 €", ts: at("2026-10-09") };
  const note = { message_id: "<n2@test>", subject: "Note added to your SHOPDEMO order from 09/10/2026", from_name: "SHOPDEMO", from_address: "orders@m.shopdemo.test", text: "A note has been added to your order.\nTracking number: 0000\nOrder #51860 ( 09/10/2026 )\nSwitch X ×1 958.00 €\nShipping 29.00 €\nTotal: 987.00 €", ts: at("2026-10-13") };
  installFakeSource([receipt, note]);
  await engine.scanMail({ trigger: "test" });
  const queue = engine.reviewQueue();
  assert.equal(queue.length, 1);
  assert.equal(db().prepare("SELECT state FROM mail_messages WHERE message_id = ?").get("<n2@test>").state, "duplicate");
});

test("the review queue points at a twin with the same amount and at an entry already recorded", async () => {
  createAccount({ name: "Tarjeta Ficticia", type: "card" }); // two accounts and no setting: everything waits in review
  createEntry({ date: "2026-10-14", amount_cents: -2599, account_id: account.id, counterparty: "Otra cosa" });
  installFakeSource([
    { message_id: "<t1@test>", subject: "Your receipt from Demo Store", from_name: "Demo Store", from_address: "billing@demostore.test", text: "Receipt\nTotal: 25,99 €\nPaid on 13/10/2026", ts: at("2026-10-13") },
    { message_id: "<t2@test>", subject: "Invoice no. 7788123", from_name: "Demo Billing SIA", from_address: "invoices@billingdemo.test", text: "Please find invoice 7788123 for the amount of 25.99 EUR.\nTotal: 25,99 €", ts: at("2026-10-15") },
  ]);
  await engine.scanMail({ trigger: "test" });
  const queue = engine.reviewQueue();
  assert.equal(queue.length, 2);
  for (const item of queue) {
    assert.equal(item.possible_duplicates.length, 1);
    assert.ok(item.possible_entry, "the recorded entry with the same amount");
  }
  db().exec("DELETE FROM accounts WHERE name = 'Tarjeta Ficticia'");
});
