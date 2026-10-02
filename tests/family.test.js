// The family side of Ledger: movement lookup and document links, the hub's mail gateway, events, forecast, shared expenses,
// sales as income, the year report, the agenda. The hub is faked (no network).
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "./helpers.js";
import { MAIL } from "./mail-fixtures.js";
import { fakeSource, setMailSourceFor, captureNotifications } from "./mail-helpers.js";
import * as engine from "../server/mail-engine.js";
import { createRoutedSource, registerInterest, forgetInterest, WATERMARK_KEY } from "../server/mail-hub.js";
import { setMailSource } from "../server/mail-source.js";
import { updateMailSettings } from "../server/mail-settings.js";
import { setFamilyApi, setAppUrl } from "../server/family.js";
import { db, getSetting, setSetting } from "../server/db.js";
import { createEntry, listEntries, getEntry, deleteEntry } from "../server/entries.js";
import { createAccount } from "../server/accounts.js";
import { createCategory } from "../server/categories.js";
import { createSubscription } from "../server/subscriptions.js";
import { forecastMonth } from "../server/outlook.js";
import { agendaItems } from "../server/agenda.js";
import { resolveDocUrl } from "../server/tx-links.js";
import { parseMail } from "../server/mail-parse.js";

let s;
let sink;
let bank;
const wipe = () => {
  for (const table of ["splits", "settlements", "sales_lines", "entries", "mail_messages", "subscriptions", "mail_runs", "notifications", "scenario_lines", "scenarios"]) db().exec(`DELETE FROM ${table}`);
  db().exec("DELETE FROM settings WHERE key LIKE 'mail.%'");
  updateMailSettings({ account: "", auto_record: true, min_confidence: 70, toast: false, hub: true, quiet_history: false, source: "auto" });
  forgetInterest();
  setFamilyApi(null);
  setAppUrl("");
};
const add = (date, cents, counterparty, extra = {}) => createEntry({ date, amount_cents: cents, account_id: bank.id, counterparty, source: "manual", ...extra });
const tool = async (name, args = {}) => (await s.agent(name, args));

before(async () => {
  s = await bootServer();
  sink = captureNotifications();
  bank = createAccount({ name: "Banco Ficticio", opening_balance: 100000 });
});
after(async () => { sink.restore(); setFamilyApi(null); await s.stop(); });
beforeEach(() => { wipe(); sink.events.length = 0; });

// ------------------------------------------------------------------ the hub, faked
function fakeHub({ available = true, messages = [], people = [], mercator = null, appUrl = "http://127.0.0.1:5200" } = {}) {
  const api = {
    available, messages, calls: [], claims: [], interests: [], pages: [], links: [],
    async mailAvailable() { return api.available; },
    async mailRegisterInterest(spec) { api.interests.push(spec); return { ok: true }; },
    async mailMessages({ sinceId = 0, limit = 100 }) {
      api.pages.push(sinceId);
      const rows = api.messages.filter((m) => m.id > sinceId).slice(0, limit);
      return { ok: true, messages: rows, last_id: rows.length ? rows.at(-1).id : sinceId };
    },
    async mailClaim(ids, kind, ref) { api.claims.push({ ids, kind, ref }); return { ok: true }; },
    async refsLink(from, to, rel, labels) { api.links.push({ from, to, rel, labels }); return { ok: true }; },
    async appInfo(app) { return app === "kafka" && appUrl ? { id: app, url: appUrl } : null; },
    async call(app, toolName, args) {
      api.calls.push({ app, tool: toolName, args });
      if (app === "people" && toolName === "find_people") {
        if (people === null) return { ok: false, error: "hub not reachable" };
        const q = String(args.query).toLowerCase();
        const candidates = people.filter((p) => p.name.toLowerCase().includes(q)).map((p) => ({ ...p, score: p.name.toLowerCase() === q ? 1 : p.name.toLowerCase().startsWith(q) ? 0.8 : 0.65 }));
        return { ok: true, app, tool: toolName, status: 200, result: { candidates } };
      }
      if (app === "people" && toolName === "get_person") {
        const p = people && people.find((x) => x.id === args.person);
        return p ? { ok: true, result: { ...p } } : { ok: true, result: { ok: false, error: "no existe" } };
      }
      if (app === "mercator" && toolName === "sales_batch_get") {
        if (!mercator) return { ok: false, error: "Mercator is not running" };
        return { ok: true, app, tool: toolName, status: 200, result: mercator };
      }
      return { ok: false, error: "unknown tool" };
    },
  };
  setFamilyApi(api);
  return api;
}
const hubMessage = (id, name, patch = {}) => ({ id, ...MAIL[name], ...patch });

// ------------------------------------------------------------------ tx_find and tx_attach_doc
test("tx_find scores amount, date and merchant, best first, and only looks at expenses", async () => {
  const exact = add("2026-10-05", -5499, "Tienda Ejemplo S.L.");
  const near = add("2026-10-08", -5499, "Otra Tienda");
  add("2026-10-05", 5499, "Reembolso Tienda Ejemplo");           // an income: never a match for an invoice
  add("2026-10-05", -5500, "Tienda Ejemplo S.L.");               // another amount
  add("2026-09-01", -5499, "Tienda Ejemplo S.L.");               // outside the window
  const out = (await tool("tx_find", { amount: "54,99", date: "2026-10-05", merchant: "Tienda Ejemplo" })).body;
  assert.equal(out.ok, true);
  assert.deepEqual(out.matches.map((m) => m.tx_id), [exact.id, near.id]);
  assert.equal(out.matches[0].score, 1);
  assert.equal(out.matches[0].amount, 54.99);
  assert.equal(out.matches[0].merchant, "Tienda Ejemplo S.L.");
  assert.ok(out.matches[1].score < 0.8, "another merchant three days away is not a strong match");
  // a number works as the amount, days narrows the window, a currency filters
  const narrow = (await tool("tx_find", { amount: 54.99, date: "2026-10-05", days: 1 })).body;
  assert.deepEqual(narrow.matches.map((m) => m.tx_id), [exact.id]);
  assert.ok(narrow.matches[0].score < 0.8, "without a merchant the score never reaches strong");
  assert.equal((await tool("tx_find", { amount: "54,99", date: "2026-10-05", currency: "USD" })).body.matches.length, 0);
  assert.equal((await tool("tx_find", { amount: "abc", date: "2026-10-05" })).status, 400);
  assert.equal((await tool("tx_find", { amount: "1", date: "nunca" })).status, 400);
});

test("tx_attach_doc keeps a list of document references, idempotent by reference, shown with the entry", async () => {
  const e = add("2026-10-05", -2000, "Tienda");
  const ref = "hoard://kafka/document/d_abc123";
  const first = (await tool("tx_attach_doc", { tx_id: e.id, doc_ref: ref, label: "Factura de octubre" })).body;
  assert.equal(first.ok, true);
  assert.equal(first.already, false);
  const again = (await tool("tx_attach_doc", { tx_id: e.id, doc_ref: ref, label: "Factura 10/2026" })).body;
  assert.equal(again.already, true);
  assert.equal(again.docs.length, 1);
  assert.equal(again.docs[0].label, "Factura 10/2026");
  await tool("tx_attach_doc", { tx_id: e.id, doc_ref: "hoard://kafka/document/d_other" });
  assert.deepEqual(getEntry(e.id).docs.map((d) => d.ref), [ref, "hoard://kafka/document/d_other"]);
  assert.equal((await tool("tx_attach_doc", { tx_id: e.id, doc_ref: "no es una referencia" })).status, 400);
  assert.equal((await tool("tx_attach_doc", { tx_id: "nope", doc_ref: ref })).status, 404);
  const listed = (await s.call("GET", `/api/entries?text=Tienda`)).body.items.find((i) => i.id === e.id);
  assert.equal(listed.docs.length, 2);
  // the tool answers tx_find with the number of documents already on a movement
  assert.equal((await tool("tx_find", { amount: "20", date: "2026-10-05" })).body.matches[0].docs, 2);
  const del = await s.call("DELETE", `/api/entries/${e.id}/docs?ref=${encodeURIComponent(ref)}`);
  assert.equal(del.body.docs.length, 1);
});

test("a document reference opens in the app that owns it, through the hub", async () => {
  fakeHub();
  assert.deepEqual(await resolveDocUrl("hoard://kafka/document/d_9"), { ok: true, app: "kafka", url: "http://127.0.0.1:5200/#/documentos/d_9" });
  const other = await resolveDocUrl("hoard://phileas/shipment/4");
  assert.equal(other.ok, false);
  assert.match(other.error, /phileas/);
  assert.equal((await resolveDocUrl("nada")).ok, false);
  const route = (await s.call("GET", `/api/doc-link?ref=${encodeURIComponent("hoard://kafka/document/d_9")}`)).body;
  assert.equal(route.url, "http://127.0.0.1:5200/#/documentos/d_9");
});

// ------------------------------------------------------------------ mail through the hub
test("mail.source auto reads from the hub, registers what it wants, claims each payment and resumes after the watermark", async () => {
  const hub = fakeHub({ messages: [hubMessage(5, "netflix"), hubMessage(6, "spotify11")] });
  const own = fakeSource([MAIL.paypal]);
  const router = createRoutedSource({ own });
  setMailSource(router);
  const out = await engine.scanMail({ trigger: "test", source: router, nowMs: Date.parse("2026-10-09T12:00:00Z") });
  assert.equal(out.ok, true);
  assert.equal(own.calls, 0, "the helper is not used while the hub is up");
  assert.equal(out.recorded, 2);
  assert.equal(hub.interests.length, 1);
  assert.ok(hub.interests[0].subject_terms.includes("factura"));
  assert.equal(getSetting(WATERMARK_KEY), 6);
  const byMerchant = Object.fromEntries(listEntries({ limit: 50 }).items.map((e) => [e.counterparty, e]));
  assert.deepEqual(hub.claims.map((c) => [c.ids, c.kind, c.ref]).sort(), [
    [[5], "payment", `hoard://ledger/tx/${byMerchant.Netflix.id}`], [[6], "payment", `hoard://ledger/tx/${byMerchant.Spotify.id}`],
  ].sort());
  // the next scan starts after the watermark: only the new message is read and filed
  hub.messages.push(hubMessage(7, "appstore"));
  const next = await engine.scanMail({ trigger: "test", source: router, nowMs: Date.parse("2026-10-09T12:00:00Z") });
  assert.equal(next.recorded, 1);
  assert.equal(hub.pages.at(-1), 6);
  assert.equal(getSetting(WATERMARK_KEY), 7);
  assert.equal(hub.interests.length, 1, "the interest is registered once, not at every scan");
});

test("mail.source: hub down falls back to the helper in auto, never in hub, and faustus never asks the hub", async () => {
  const hub = fakeHub({ available: false, messages: [hubMessage(5, "netflix")] });
  const own = fakeSource([MAIL.netflix]);
  const router = createRoutedSource({ own });
  const auto = await engine.scanMail({ trigger: "test", source: router });
  assert.equal(auto.recorded, 1);
  assert.equal(own.calls, 1);
  assert.equal(hub.pages.length, 0);
  assert.equal((await router.status()).source, "faustus");
  // hub only: no helper behind it
  db().exec("DELETE FROM mail_messages; DELETE FROM entries");
  updateMailSettings({ source: "hub" });
  hub.available = false;
  const failing = { ...hub, mailMessages: async () => ({ ok: false, error: "hub unreachable" }) };
  setFamilyApi(failing);
  const only = await engine.scanMail({ trigger: "test", source: router });
  assert.equal(only.ok, false);
  assert.match(only.error, /hub/);
  assert.equal(own.calls, 1, "hub mode does not fall back");
  // helper only: the hub is not consulted even when it is up
  updateMailSettings({ source: "faustus" });
  const asked = fakeHub({ messages: [hubMessage(5, "netflix")] });
  const own2 = fakeSource([MAIL.netflix]);
  const router2 = createRoutedSource({ own: own2 });
  await engine.scanMail({ trigger: "test", source: router2 });
  assert.equal(own2.calls, 1);
  assert.equal(asked.pages.length, 0);
  assert.equal((await router2.status()).mode, "faustus");
});

test("a hub mail with a deep search re-reads from the start and leaves the watermark alone", async () => {
  const hub = fakeHub({ messages: [hubMessage(5, "netflix"), hubMessage(6, "spotify11")] });
  const router = createRoutedSource({ own: fakeSource([]) });
  setSetting(WATERMARK_KEY, 6);
  const out = await engine.scanMail({ trigger: "test", source: router, since_days: 90, nowMs: Date.parse("2026-10-09T12:00:00Z") });
  assert.equal(out.recorded, 2);
  assert.equal(hub.pages[0], 0);
  assert.equal(getSetting(WATERMARK_KEY), 6);
  const search = await router.scan({ since_days: 90, limit: 10, skip: [], query: "spotify", subject_terms: [] });
  assert.deepEqual(search.messages.map((m) => m.hub_id), ["6"]);
  assert.equal(search.hub_last_id, null);
});

test("accepting a mail from review records it, claims it and tells the family", async () => {
  const hub = fakeHub({ messages: [hubMessage(8, "netflix")] });
  const router = createRoutedSource({ own: fakeSource([]) });
  updateMailSettings({ auto_record: false });
  const scan = await engine.scanMail({ trigger: "test", source: router, nowMs: Date.parse("2026-10-09T12:00:00Z") });
  assert.equal(scan.review, 1);
  assert.equal(hub.claims.length, 0, "nothing is claimed while it waits for review");
  const out = await engine.acceptMail(MAIL.netflix.message_id, {});
  assert.deepEqual(hub.claims.map((c) => [c.ids, c.kind, c.ref]), [[[8], "payment", `hoard://ledger/tx/${out.entry.id}`]]);
  const event = sink.events.find((e) => e.type === "ledger.mail.recorded").data;
  assert.equal(event.tx_id, out.entry.id);
  assert.equal(event.amount, 12.99);
});

test("the hub registration is cached and renewed after the settings change", async () => {
  const hub = fakeHub();
  await registerInterest(["factura"]);
  await registerInterest(["factura"]);
  assert.equal(hub.interests.length, 1);
  updateMailSettings({ interval_min: 20 });
  await registerInterest(["factura"]);
  assert.equal(hub.interests.length, 2);
  await registerInterest(["factura"], { force: true });
  assert.equal(hub.interests.length, 3);
});

// ------------------------------------------------------------------ events
test("ledger.mail.recorded carries tx_id, amount in major units, currency, date, order_ref, message_id and items", async () => {
  fakeHub();
  setMailSource(fakeSource([MAIL.amazon]));
  const out = await engine.scanMail({ trigger: "test", nowMs: Date.parse("2026-10-09T12:00:00Z") });
  assert.equal(out.recorded, 1);
  const e = listEntries({ limit: 5 }).items[0];
  const data = sink.events.find((x) => x.type === "ledger.mail.recorded").data;
  assert.equal(data.tx_id, e.id);
  assert.equal(data.merchant, "Amazon");
  assert.equal(data.amount, 54.2);
  assert.equal(data.currency, "EUR");
  assert.equal(data.date, "2026-10-08");
  assert.equal(data.order_ref, "123-4567890-1234567");
  assert.equal(data.message_id, MAIL.amazon.message_id);
  assert.deepEqual(data.items, []);
  assert.equal(data.kind, "payment");
});

test("order numbers are read from «pedido», «order», «nº de pedido» and Amazon's 3-7-7 form", () => {
  const ref = (subject, text) => parseMail({ message_id: "<x>", subject, from_name: "Tienda", from_address: "pedidos@tienda.example", ts: Date.parse("2026-10-08T12:00:00Z") / 1000, text }, { now: Date.parse("2026-10-09T12:00:00Z") }).order_ref;
  assert.equal(ref("Tu pedido", "Gracias por tu compra.\nPedido nº ES-2026-88123\nTotal del pedido: 20,00 €"), "ES-2026-88123");
  assert.equal(ref("Order confirmation", "Thanks for shopping.\nOrder #A8812377\nOrder total: 20,00 EUR"), "A8812377");
  assert.equal(ref("Confirmación de tu compra", "Número de pedido: 55912\nTotal: 20,00 €"), "55912");
  assert.equal(ref("Tu pedido de Amazon.es", "Pedido 402-1234567-7654321\nTotal del pedido: 20,00 €"), "402-1234567-7654321");
  assert.equal(ref("Recibo", "Total: 20,00 €"), null);
});

test("failed payment, price change and new subscription events carry amounts in major units", async () => {
  setAppUrl("http://127.0.0.1:5180");
  setMailSource(fakeSource([MAIL.spotify10, MAIL.spotify11, MAIL.netflix, MAIL.failed]));
  await engine.scanMail({ trigger: "test", nowMs: Date.parse("2026-10-09T12:00:00Z") });
  const by = (type) => sink.events.filter((e) => e.type === type).map((e) => e.data);
  const failed = by("ledger.payment.failed")[0];
  assert.equal(failed.merchant, "Netflix");
  assert.equal(typeof failed.amount, "number");
  assert.equal(failed.currency, "EUR");
  const price = by("ledger.subscription.price").find((d) => d.merchant === "Spotify");
  assert.equal(price.old_amount, 10.99);
  assert.equal(price.amount, 11.99);
  assert.equal(price.currency, "EUR");
  const created = by("ledger.subscription.new").find((d) => d.merchant === "Netflix");
  assert.equal(created.amount, 12.99);
  assert.equal(created.url, "http://127.0.0.1:5180/#/suscripciones");
});

// ------------------------------------------------------------------ forecast_month
function ledgerOfAMonth() {
  for (const m of ["2026-07", "2026-08", "2026-09"]) {
    add(`${m}-28`, 150000, "Empresa Ficticia S.L.");
    add(`${m}-03`, -60000, "Alquiler Casa");
    add(`${m}-15`, -3000, "Gimnasio Fit");
    add(`${m}-10`, -20000, "Super Demo");
  }
  add("2026-10-03", -60000, "Alquiler Casa");
  createSubscription({ merchant: "Streaming Plus", amount_cents: 1299, period: "monthly", next_charge_date: "2026-10-20" }, { source: "mail" });
}

test("forecast_month: today's balance plus what repeats and the average of the rest of the spending", () => {
  ledgerOfAMonth();
  const f = forecastMonth({ month: "2026-10", today: "2026-10-10" });
  assert.equal(f.ok, true);
  assert.equal(f.today_balance, 2410);                     // 1000 + 3 x 1500 - 4 x 600 - 3 x 30 - 3 x 200
  assert.equal(f.expected_in, 1500);
  const kinds = Object.fromEntries(f.lines.map((l) => [l.label, l]));
  assert.equal(kinds["Empresa Ficticia S.L."].date, "2026-10-28");
  assert.equal(kinds["Gimnasio Fit"].amount, -30);
  assert.equal(kinds["Gimnasio Fit"].kind, "recurring");
  assert.equal(kinds["Streaming Plus"].kind, "subscription");
  assert.equal(kinds["Streaming Plus"].date, "2026-10-20");
  assert.ok(!("Alquiler Casa" in kinds), "the rent of October is already in the balance");
  const variable = f.lines.find((l) => l.kind === "variable");
  assert.ok(variable && variable.amount < 0);
  // 3-month average 830, minus the subscription's 12.99, for 21 of 31 days
  assert.equal(variable.amount_cents, -Math.round(((83000 - 1299) * 21) / 31));
  assert.equal(f.projected_end_cents, f.today_balance_cents + f.expected_in_cents - f.expected_out_cents);
  assert.equal(f.expected_out_cents, f.lines.filter((l) => l.amount_cents < 0).reduce((a, l) => a - l.amount_cents, 0));
  // next month starts where this one ends and includes the rent
  const next = forecastMonth({ month: "2026-11", today: "2026-10-10" });
  assert.equal(next.today_balance_cents, f.projected_end_cents);
  assert.ok(next.lines.some((l) => l.label === "Alquiler Casa" && l.date === "2026-11-03"));
  assert.ok(next.lines.some((l) => l.label === "Empresa Ficticia S.L." && l.date === "2026-11-28"));
  assert.ok(next.lines.some((l) => l.label === "Streaming Plus" && l.date === "2026-11-20"));
});

test("forecast_month: a past month is the real balance, cancelled subscriptions and bad months are refused", () => {
  ledgerOfAMonth();
  const past = forecastMonth({ month: "2026-08", today: "2026-10-10" });
  assert.equal(past.lines.length, 0);
  assert.equal(past.projected_end_cents, past.today_balance_cents);
  db().prepare("UPDATE subscriptions SET status = 'cancelled'").run();
  assert.ok(!forecastMonth({ month: "2026-10", today: "2026-10-10" }).lines.some((l) => l.label === "Streaming Plus"));
  assert.throws(() => forecastMonth({ month: "octubre" }), /Mes no válido/);
  assert.throws(() => forecastMonth({ month: "2028-12", today: "2026-10-10" }), /12 meses/);
});

test("forecast_month is a tool and a route", async () => {
  add("2026-01-05", -1000, "Algo");
  const r = (await tool("forecast_month", { month: "2026-01" })).body;
  assert.equal(r.ok, true);
  assert.equal(r.month, "2026-01");
  assert.equal(typeof r.today_balance, "number");
  assert.equal((await s.call("GET", "/api/forecast/month?month=2026-01")).body.projected_end, r.projected_end);
  assert.equal((await tool("forecast_month", { month: "01-2026" })).status, 400);
});

// ------------------------------------------------------------------ shared expenses
const PEOPLE = [{ id: "a1b2c3d4-0001", name: "Marta Prueba" }, { id: "a1b2c3d4-0002", name: "Pablo Prueba" }, { id: "a1b2c3d4-0003", name: "Pablo Ejemplo" }];

test("split_add resolves people through the address book, splits by share, amount or equally, and repeating updates", async () => {
  const hub = fakeHub({ people: PEOPLE });
  const dinner = add("2026-10-01", -10000, "Restaurante Demo");
  const out = (await tool("split_add", { tx_id: dinner.id, participants: [{ person: "Marta Prueba", share: 0.25 }, { person: "a1b2c3d4-0002", amount: "30" }] })).body;
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.deepEqual(out.participants.map((p) => [p.person, p.person_ref, p.share_cents, p.resolved]), [
    ["Marta Prueba", "hoard://people/person/a1b2c3d4-0001", 2500, true], ["Pablo Prueba", "hoard://people/person/a1b2c3d4-0002", 3000, true],
  ]);
  assert.equal(out.my_share_cents, 4500);
  assert.ok(hub.calls.some((c) => c.tool === "find_people" && c.args.query === "Marta Prueba"));
  // a percentage, and a repeat updates instead of duplicating
  const again = (await tool("split_add", { tx_id: dinner.id, participants: [{ person: "Marta Prueba", share: 50 }] })).body;
  assert.equal(again.participants[0].share_cents, 5000);
  const balance = (await tool("splits_balance", { person: "Marta" })).body;
  assert.equal(balance.balances.length, 1);
  assert.equal(balance.balances[0].balance_cents, 5000);
  assert.equal(balance.balances[0].direction, "owes_me");
  // equal parts, the payer included
  const taxi = add("2026-10-02", -3000, "Taxi Demo");
  const equal = (await tool("split_add", { tx_id: taxi.id, participants: [{ person: "Marta Prueba" }, { person: "Pablo Prueba" }] })).body;
  assert.deepEqual(equal.participants.map((p) => p.share_cents), [1000, 1000]);
  assert.equal(equal.my_share_cents, 1000);
  assert.match(equal.note, /partes iguales/);
});

test("split_add refuses what cannot be split: income, transfers, over-allocation, mixed parts, doubles and ambiguous names", async () => {
  fakeHub({ people: PEOPLE });
  const pay = add("2026-10-01", -1000, "Pago");
  const income = add("2026-10-01", 1000, "Cobro");
  assert.equal((await tool("split_add", { tx_id: income.id, participants: [{ person: "Marta Prueba" }] })).status, 400);
  assert.equal((await tool("split_add", { tx_id: "nope", participants: [{ person: "Marta Prueba" }] })).status, 404);
  assert.match((await tool("split_add", { tx_id: pay.id, participants: [{ person: "Marta Prueba", amount: "8" }, { person: "a1b2c3d4-0002", amount: "5" }] })).body.error, /Reparto/);
  assert.match((await tool("split_add", { tx_id: pay.id, participants: [{ person: "Marta Prueba", amount: "2" }, { person: "a1b2c3d4-0002" }] })).body.error, /de todas las personas/);
  assert.match((await tool("split_add", { tx_id: pay.id, participants: [{ person: "Marta Prueba" }, { person: "a1b2c3d4-0001" }] })).body.error, /dos veces/);
  const ambiguous = await tool("split_add", { tx_id: pay.id, participants: [{ person: "Pablo" }] });
  assert.equal(ambiguous.status, 400);
  assert.deepEqual(ambiguous.body.candidates.sort(), ["Pablo Ejemplo", "Pablo Prueba"]);
  assert.equal((await tool("split_add", { tx_id: pay.id, participants: [{ person: "Marta Prueba", share: 0.5, amount: "1" }] })).status, 400);
  assert.equal((await tool("split_add", { tx_id: pay.id, participants: [] })).status, 400);
  assert.equal(db().prepare("SELECT COUNT(*) AS n FROM splits").get().n, 0, "a refused split leaves nothing behind");
});

test("people not in the address book, or an address book that does not answer, are kept by name", async () => {
  fakeHub({ people: [] });
  const pay = add("2026-10-01", -2000, "Pizzería Demo");
  const out = (await tool("split_add", { tx_id: pay.id, participants: [{ person: "Lucía", amount: "5" }] })).body;
  assert.equal(out.participants[0].resolved, false);
  assert.equal(out.participants[0].person_ref, "");
  assert.match(out.participants[0].note, /solo con el nombre/);
  fakeHub({ people: null });
  const down = (await tool("split_add", { tx_id: pay.id, participants: [{ person: "Lucía", amount: "2" }] })).body;
  assert.equal(down.participants[0].resolved, false);
  assert.match(down.participants[0].note, /no respondió/);
  const balance = (await tool("splits_balance")).body;
  assert.equal(balance.balances.length, 1, "the same name is the same person");
  assert.equal(balance.balances[0].balance_cents, 200);
  // a person known by name and later by reference is one person
  fakeHub({ people: [{ id: "a1b2c3d4-0009", name: "Lucía" }] });
  const other = add("2026-10-03", -1000, "Café Demo");
  await tool("split_add", { tx_id: other.id, participants: [{ person: "Lucía", amount: "3" }] });
  const merged = (await tool("splits_balance")).body.balances;
  assert.equal(merged.length, 1);
  assert.equal(merged[0].balance_cents, 500);
  assert.equal(merged[0].person_ref, "hoard://people/person/a1b2c3d4-0009");
});

test("split_settle records paybacks up to what is owed and the balance follows", async () => {
  fakeHub({ people: PEOPLE });
  const dinner = add("2026-08-01", -10000, "Cena Demo");
  const trip = add("2026-09-15", -6000, "Gasolina Demo");
  await tool("split_add", { tx_id: dinner.id, participants: [{ person: "Marta Prueba", amount: "40" }] });
  await tool("split_add", { tx_id: trip.id, participants: [{ person: "Marta Prueba", amount: "20" }] });
  let b = (await tool("splits_balance", { person: "Marta Prueba" })).body.balances[0];
  assert.equal(b.balance_cents, 6000);
  assert.equal(b.oldest_open_date, "2026-08-01");
  const received = add("2026-10-05", 5000, "Bizum Marta", {});
  const paid = (await tool("split_settle", { person: "Marta Prueba", amount: "50", tx_id: received.id })).body;
  assert.equal(paid.balance_cents, 1000);
  assert.equal(paid.settled, false);
  b = (await tool("splits_balance", { person: "Marta Prueba" })).body.balances[0];
  assert.equal(b.oldest_open_date, "2026-09-15", "paybacks cover the oldest expense first");
  assert.equal((await tool("split_settle", { person: "Marta Prueba", amount: "11" })).status, 409);
  assert.equal((await tool("split_settle", { person: "Marta Prueba", amount: "0" })).status, 400);
  assert.equal((await tool("split_settle", { person: "Marta Prueba", amount: "5", tx_id: "nope" })).status, 404);
  assert.equal((await tool("split_settle", { person: "Pablo Prueba", amount: "5" })).status, 409);
  const done = (await tool("split_settle", { person: "Marta Prueba", amount: "10" })).body;
  assert.equal(done.settled, true);
  assert.equal((await tool("splits_balance", { person: "Marta Prueba" })).body.balances[0].direction, "settled");
  assert.equal((await tool("splits_balance")).body.owed_to_me_cents, 0);
});

test("deleting a movement takes its shares with it; the routes list and remove shares", async () => {
  fakeHub({ people: PEOPLE });
  const pay = add("2026-10-01", -4000, "Compra Demo");
  const created = await s.call("POST", "/api/splits", { tx_id: pay.id, participants: [{ person: "Marta Prueba", amount: "10" }, { person: "Pablo Prueba", amount: "5" }] });
  assert.equal(created.status, 201);
  assert.equal((await s.call("GET", `/api/entries/${pay.id}/splits`)).body.splits.length, 2);
  assert.equal((await s.call("DELETE", `/api/entries/${pay.id}/splits?person=${encodeURIComponent("hoard://people/person/a1b2c3d4-0002")}`)).body.removed, 1);
  assert.equal((await s.call("GET", "/api/splits/balance")).body.balances.length, 1);
  deleteEntry(pay.id);
  assert.equal((await s.call("GET", "/api/splits/balance")).body.balances.length, 0);
  const settle = await s.call("POST", "/api/splits/settle", { person: "Marta Prueba", amount: "1" });
  assert.equal(settle.status, 409);
});

// ------------------------------------------------------------------ income from sales
const BATCH = {
  ok: true, batch: "imp-1", count: 4, lines: [
    { line: 1, id: "a", sold_at: "2026-09-28", product: "Modelo A", amount: "12.50", currency: "EUR" },
    { line: 2, id: "b", sold_at: "2026-09-28", product: "Modelo B", amount: "9.00", currency: "EUR" },
    { line: 3, id: "c", sold_at: "2026-09-29", product: "Modelo C", amount: "4.00", currency: "EUR" },
    { line: 4, id: "d", sold_at: "2026-09-29", product: "Modelo D", amount: "3.00", currency: "USD" },
  ],
};

test("income_from_sales books one income per currency and day and is idempotent by batch and line", async () => {
  const hub = fakeHub({ mercator: BATCH });
  createCategory({ name: "Ventas tienda", kind: "income" });
  const first = (await tool("income_from_sales", { batch: "imp-1" })).body;
  assert.equal(first.ok, true);
  assert.deepEqual(first.created.map((c) => [c.date, c.currency, c.amount_cents, c.lines]), [["2026-09-28", "EUR", 2150, [1, 2]], ["2026-09-29", "EUR", 400, [3]]]);
  assert.deepEqual(first.skipped, [{ line: 4, reason: "no hay ninguna cuenta en USD" }]);
  assert.deepEqual(hub.calls.at(-1), { app: "mercator", tool: "sales_batch_get", args: { batch: "imp-1" } });
  const entry = getEntry(first.created[0].tx_id);
  assert.equal(entry.amount_cents, 2150);
  assert.equal(entry.category_name, "Ventas tienda");
  assert.equal(entry.source_ref, "sales:imp-1:EUR:2026-09-28");
  assert.match(entry.note, /líneas 1, 2/);
  assert.ok(hub.links.some((l) => l.from === `hoard://ledger/tx/${entry.id}` && l.to === "hoard://mercator/sales/imp-1" && l.rel === "income"));
  // again: nothing new, the USD line is still waiting for an account
  const again = (await tool("income_from_sales", { batch: "imp-1" })).body;
  assert.deepEqual(again.created, []);
  assert.deepEqual(again.skipped.map((x) => x.reason).sort(), ["no hay ninguna cuenta en USD", "ya apuntada", "ya apuntada", "ya apuntada"]);
  assert.equal(listEntries({ limit: 50 }).total, 2);
  // with a USD account the pending line goes in, and only that one
  createAccount({ name: "Cuenta Dólares", currency: "USD" });
  const late = (await tool("income_from_sales", { batch: "imp-1" })).body;
  assert.deepEqual(late.created.map((c) => [c.currency, c.amount_cents]), [["USD", 300]]);
  assert.equal(listEntries({ limit: 50 }).total, 3);
});

test("income_from_sales: Mercator away, an unknown batch, a chosen account and a deleted entry", async () => {
  fakeHub({ mercator: null });
  const away = (await tool("income_from_sales", { batch: "imp-1" })).body;
  assert.equal(away.ok, false);
  assert.match(away.error, /Mercator/);
  fakeHub({ mercator: { ok: true, batch: "imp-2", count: 1, lines: [{ line: 1, sold_at: "2026-10-01", product: "X", amount: "5.00", currency: "EUR" }, { line: 2, sold_at: "2026-10-01", product: "Y", amount: "nada", currency: "EUR" }] } });
  createAccount({ name: "Caja", type: "cash" });
  const ambiguous = await tool("income_from_sales", { batch: "imp-2" });
  assert.equal(ambiguous.body.created.length, 0, "two EUR accounts: it asks instead of guessing");
  assert.ok(ambiguous.body.skipped.some((x) => /varias cuentas/.test(x.reason)));
  const chosen = (await tool("income_from_sales", { batch: "imp-2", account: "Caja" })).body;
  assert.equal(chosen.created.length, 1);
  assert.equal(chosen.created[0].account, "Caja");
  assert.ok(chosen.skipped.some((x) => x.reason === "importe no válido"));
  // the person deleted the movement: the line stays booked, it does not come back
  deleteEntry(chosen.created[0].tx_id);
  assert.equal((await tool("income_from_sales", { batch: "imp-2", account: "Caja" })).body.created.length, 0);
  assert.equal((await tool("income_from_sales", { batch: "" })).status, 400);
});

// ------------------------------------------------------------------ budget and year
test("budget_status takes a category and answers ok, budget, spent and left", async () => {
  const food = createCategory({ name: "Comida de prueba", kind: "expense", monthly_budget: 30000 });
  createCategory({ name: "Ocio de prueba", kind: "expense", monthly_budget: 5000 });
  add("2026-10-02", -12000, "Super", { category_id: food.id });
  const all = (await tool("budget_status", { month: "2026-10" })).body;
  assert.equal(all.ok, true);
  assert.ok(all.categories.length >= 2);
  const one = (await tool("budget_status", { month: "2026-10", category: "comida de prueba" })).body;
  assert.deepEqual(one.categories.map((c) => [c.category, c.budget, c.spent, c.left]), [["Comida de prueba", 30000, 12000, 18000]]);
  assert.match(one.verdict, /Comida de prueba dentro de presupuesto/);
  assert.equal((await tool("budget_status", { category: "inexistente" })).status, 400);
});

test("report_year totals by month and category, and is a route", async () => {
  const food = createCategory({ name: "Comida anual", kind: "expense" });
  add("2025-01-10", -2000, "Super", { category_id: food.id });
  add("2025-01-20", -1000, "Super", { category_id: food.id });
  add("2025-03-05", 150000, "Nomina");
  add("2025-03-06", -500, "Sin clasificar");
  add("2026-01-01", -999, "Otro año");
  const r = (await tool("report_year", { year: 2025 })).body;
  assert.equal(r.ok, true);
  assert.equal(r.year, 2025);
  assert.equal(r.income_cents, 150000);
  assert.equal(r.expense_cents, 3500);
  assert.equal(r.by_month.length, 12);
  assert.deepEqual(r.by_month.filter((m) => m.expense_cents || m.income_cents).map((m) => m.month), ["2025-01", "2025-03"]);
  const cat = r.by_category.find((c) => c.category === "Comida anual");
  assert.equal(cat.spent_cents, 3000);
  assert.equal(cat.by_month_spent_cents[0], 3000);
  assert.ok(r.by_category.some((c) => c.category === "Sin categoría"));
  assert.equal((await s.call("GET", "/api/reports/year?year=2025")).body.net_cents, 146500);
  assert.equal((await tool("report_year", { year: 1800 })).status, 400);
  assert.equal((await tool("report_year", { year: 2030 })).body.movements, 0);
});

// ------------------------------------------------------------------ the agenda
test("the agenda lists renewals, trial ends, expected charges and debts older than 30 days", async () => {
  fakeHub({ people: PEOPLE });
  const yearly = createSubscription({ merchant: "Dominio Demo", amount_cents: 1500, period: "yearly", next_charge_date: "2026-10-12" }, { source: "mail" });
  const monthly = createSubscription({ merchant: "Streaming Plus", amount_cents: 1299, period: "monthly", next_charge_date: "2026-10-25" }, { source: "mail" });
  const trial = createSubscription({ merchant: "Prueba Demo", amount_cents: 500, period: "monthly", status: "trial" }, { source: "mail" });
  db().prepare("UPDATE subscriptions SET trial_end_date = '2026-10-11' WHERE id = ?").run(trial.id);
  const cancelled = createSubscription({ merchant: "Cancelada", amount_cents: 100, period: "monthly", next_charge_date: "2026-10-14" }, { source: "mail" });
  db().prepare("UPDATE subscriptions SET status = 'cancelled' WHERE id = ?").run(cancelled.id);
  for (const m of ["2026-07", "2026-08", "2026-09"]) add(`${m}-15`, -3000, "Gimnasio Fit");
  const dinner = add("2026-08-01", -10000, "Cena Demo");
  await tool("split_add", { tx_id: dinner.id, participants: [{ person: "Marta Prueba", amount: "40" }] });
  const recent = add("2026-10-05", -2000, "Café Demo");
  await tool("split_add", { tx_id: recent.id, participants: [{ person: "Pablo Prueba", amount: "10" }] });
  const items = agendaItems("2026-10-10", "2026-10-31", "", { today: "2026-10-10" });
  const by = Object.fromEntries(items.map((i) => [i.title, i]));
  assert.equal(by["Dominio Demo se renueva"].kind, "renewal");
  assert.equal(by["Dominio Demo se renueva"].priority, "high");
  assert.equal(by["Streaming Plus se renueva"].priority, "low");
  assert.equal(by["Termina la prueba de Prueba Demo"].kind, "deadline");
  assert.equal(by["Termina la prueba de Prueba Demo"].priority, "urgent");
  assert.ok(!("Cancelada se renueva" in by));
  assert.equal(by["Cargo previsto: Gimnasio Fit"].start, "2026-10-15");
  assert.equal(by["Cargo previsto: Gimnasio Fit"].kind, "other");
  const debt = by["Marta Prueba te debe 40,00 €"];
  assert.equal(debt.kind, "followup");
  assert.equal(debt.start, "2026-10-10");
  assert.match(debt.detail, /2026-08-01/);
  assert.ok(!items.some((i) => i.title.startsWith("Pablo Prueba")), "a debt of five days is not chased yet");
  for (const i of items) assert.ok(i.id.startsWith("ledger:") && i.all_day === true);
  void yearly; void monthly;
  // a window that does not reach today has no debts
  assert.ok(!agendaItems("2026-11-01", "2026-11-30", "", { today: "2026-10-10" }).some((i) => i.kind === "followup"));
});

test("a renewal date that already passed is worked forward, and a charge a few days late is a follow-up", async () => {
  fakeHub({ people: PEOPLE });
  createSubscription({ merchant: "Red Profesional", amount_cents: 2998, period: "monthly", next_charge_date: "2026-09-04" }, { source: "mail" });
  createSubscription({ merchant: "Nube Demo", amount_cents: 299, period: "monthly", next_charge_date: "2026-10-08" }, { source: "mail" });
  const items = agendaItems("2026-10-01", "2026-10-31", "", { today: "2026-10-10" });
  const by = Object.fromEntries(items.map((i) => [i.title, i]));
  assert.ok(!items.some((i) => i.title === "Red Profesional se renueva" && i.start < "2026-10-10"), "never a renewal in the past");
  assert.equal(by["No ha llegado el cobro de Nube Demo"].kind, "followup");
  assert.equal(by["No ha llegado el cobro de Nube Demo"].start, "2026-10-10");
  assert.match(by["No ha llegado el cobro de Nube Demo"].detail, /2026-10-08/);
  const nov = agendaItems("2026-11-01", "2026-11-30", "", { today: "2026-10-10" });
  const red = nov.find((i) => i.title === "Red Profesional se renueva");
  assert.equal(red.start, "2026-11-04");
  assert.match(red.detail, /fecha estimada/);
});

test("GET /api/family/agenda answers with this app's token only", async () => {
  createSubscription({ merchant: "Streaming Plus", amount_cents: 1299, period: "monthly", next_charge_date: "2026-10-25" }, { source: "mail" });
  const denied = await s.call("GET", "/api/family/agenda?from=2026-10-01&to=2026-10-31");
  assert.equal(denied.status, 401);
  const ok = await s.call("GET", "/api/family/agenda?from=2026-10-01&to=2026-10-31", null, { Authorization: `Bearer ${s.token}` });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true);
  assert.deepEqual(ok.body.items.map((i) => [i.id.split(":")[1], i.title]), [["renewal", "Streaming Plus se renueva"]]);
});

test("the manifest announces the agenda", async () => {
  const fs = await import("node:fs");
  const manifest = JSON.parse(fs.readFileSync(new URL("../faustus-plugin.json", import.meta.url), "utf8"));
  assert.equal(manifest["x-family"].agenda, true);
});

test("the mail source is a setting (auto, hub, faustus) and the status says where mail is read from", async () => {
  assert.equal((await s.call("GET", "/api/mail/settings")).body.source, "auto");
  assert.equal((await s.call("PUT", "/api/mail/settings", { source: "hub" })).body.source, "hub");
  assert.equal((await s.call("PUT", "/api/mail/settings", { source: "otro" })).status, 400);
  updateMailSettings({ source: "auto" });
  fakeHub({ available: true });
  const router = createRoutedSource({ own: fakeSource([]) });
  const up = await router.status();
  assert.equal(up.source, "hub");
  assert.equal(up.ok, true);
  assert.equal(up.accounts[0].account, "hub gateway");
  fakeHub({ available: false });
  const down = await router.status();
  assert.equal(down.source, "faustus");
  assert.equal(down.mode, "auto");
  updateMailSettings({ source: "hub" });
  const only = await router.status();
  assert.equal(only.source, "hub");
  assert.equal(only.ok, false);
  assert.match(only.error, /hub/);
});
