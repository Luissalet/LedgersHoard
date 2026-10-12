// The Faustus copilot's view of the app: real objects per view, unsaved form fields, changed-only saves, refresh on turn end.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildContext, changedFields, collectContext, installCopilot, parseRoute, rebaseForm, registerProvider, subscribeRefresh,
} from "../client/src/copilot-context.js";

const state = {
  accounts: [{ id: "a1", name: "Cuenta corriente", type: "bank", currency: "EUR", balance: 123456, opening_balance: 1000, archived: 0 }],
  categories: [{ id: "c1", name: "Supermercado", kind: "expense", monthly_budget: 30000 }],
};
const entries = { e1: { id: "e1", date: "2026-10-03", amount_cents: -4210, counterparty: "Mercadona", account_name: "Cuenta corriente", category_name: "Supermercado", source: "manual", note: "" } };
const scenarios = { s1: { id: "s1", name: "Mudanza", lines: [{ id: "l1", label: "Alquiler", account_id: "a1", amount_cents: -65000, start_month: "2026-11", end_month: null, cadence: "monthly" }] } };
const subscriptions = { subscriptions: [{ id: "u1", merchant: "Netflix", status: "active", amount_cents: 1299, currency: "EUR", period: "monthly", next_charge_date: "2026-11-05" }] };
const deps = {
  getState: async () => state,
  getEntry: async (id) => { if (!entries[id]) throw new Error("not found"); return entries[id]; },
  getSubscriptions: async () => subscriptions,
  getScenario: async (id) => { if (!scenarios[id]) throw new Error("not found"); return scenarios[id]; },
  getSummary: async (month) => ({ month, income: 150000, expense: 90000, net: 60000, budget: { total: 30000, spent: 21000, over: 0 } }),
  getBalance: async () => ({ balances: [{ person: "Ana", person_ref: "p_ana", balance_cents: 2500, direction: "owes_me", owed_cents: 5000, paid_cents: 2500 }] }),
};
const ids = (ctx) => ctx.active_objects.map((o) => `${o.kind}:${o.object_id}`);

test("only the fields the user changed are sent, including manual clears", () => {
  assert.deepEqual(changedFields({ date: "2026-10-03", amount: "-42,10", note: "x" }, { date: "2026-10-03", amount: "-50", note: "" }), { amount: "-50", note: "" });
  assert.deepEqual(changedFields({ a: 1 }, { a: 1 }), {});
});

test("a reload keeps what the user typed and updates the rest", () => {
  const before = { counterparty: "Old", note: "" };
  const form = { counterparty: "Old", note: "typed" };
  const after = { counterparty: "Agent title", note: "" };
  assert.deepEqual(rebaseForm(before, after, form), { counterparty: "Agent title", note: "typed" });
  assert.deepEqual(changedFields(before, form), { note: "typed" });   // the agent's edit survives the user's save
});

test("route parsing defaults to the summary", () => {
  assert.equal(parseRoute("").page, "resumen");
  assert.equal(parseRoute("#/movimientos?tx=e1").query.get("tx"), "e1");
});

test("entry view returns the real movement, its filters and the open editor", async () => {
  const editors = [{ kind: "entry-form", object_id: "e1", dirty: true, fields: { note: "x" } }];
  const ctx = await buildContext({ ...deps, hash: "#/movimientos?tx=e1", editors, view: { filters: { from: "2026-10-01", account: "a1", category: "c1" } } });
  assert.deepEqual(ids(ctx), ["entry:e1", "account:a1", "category:c1"]);
  assert.equal(ctx.active_objects[0].title, "Mercadona");
  assert.equal(ctx.active_objects[0].amount_cents, -4210);
  assert.equal(ctx.view.page, "entries");
  assert.equal(ctx.view.object_id, "e1");
  assert.deepEqual(ctx.view.editor.fields, { note: "x" });
  assert.equal(ctx.view.filters.account, "a1");
});

test("unknown, new and plain list views yield no object and never throw", async () => {
  for (const [hash, view] of [["#/movimientos?tx=nope", {}], ["#/movimientos?tx=new", {}], ["#/cuentas", {}], ["#/categorias", {}], ["#/ajustes", {}], ["#/prevision", { scenario: "gone" }], ["#/compartidos", {}]]) {
    const ctx = await buildContext({ ...deps, hash, editors: [], view });
    assert.deepEqual(ctx.active_objects, [], hash);
    assert.ok(ctx.view.page);
  }
  const broken = await buildContext({ hash: "#/resumen", editors: [], view: { month: "2026-10" }, getState: async () => { throw new Error("down"); }, getSummary: async () => { throw new Error("down"); } });
  assert.deepEqual(broken.active_objects, []);
});

test("summary, reports and mail views carry the month", async () => {
  for (const hash of ["", "#/resumen", "#/informes", "#/correo"]) {
    const ctx = await buildContext({ ...deps, hash, editors: [], view: { month: "2026-10", review_count: 3 } });
    assert.deepEqual(ids(ctx), ["month:2026-10"], hash);
    assert.equal(ctx.active_objects[0].income, 150000);
    assert.equal(ctx.view.month, "2026-10");
  }
  assert.equal((await buildContext({ ...deps, hash: "#/correo", editors: [], view: { month: "2026-10", review_count: 3 } })).view.review_count, 3);
});

test("forecast view returns the open scenario with its lines and the line being edited", async () => {
  const ctx = await buildContext({ ...deps, hash: "#/prevision", view: { scenario: "s1", from: "2026-11", months: 6 }, editors: [{ kind: "scenario-line-form", object_id: "l1", scenario_id: "s1", dirty: true, fields: { amount: "-700" } }] });
  assert.deepEqual(ids(ctx), ["scenario:s1", "scenario_line:l1"]);
  assert.equal(ctx.view.months, 6);
  assert.equal(ctx.view.editor.fields.amount, "-700");
});

test("open edit forms add their object; creation forms add none", async () => {
  const ctx = await buildContext({ ...deps, hash: "#/suscripciones", view: {}, editors: [
    { kind: "subscription-form", object_id: "u1", dirty: true, fields: { notes: "n" } },
    { kind: "account-form", object_id: "a1", dirty: false, fields: {} },
    { kind: "account-form", object_id: "gone", dirty: false, fields: {} },
    { kind: "category-name", object_id: "c1", dirty: true, fields: { name: "Super" } },
    { kind: "entry-new", object_id: null, dirty: true, fields: { amount: "-3" } },
  ] });
  assert.deepEqual(ids(ctx), ["subscription:u1", "account:a1", "category:c1"]);
  assert.equal(ctx.view.editors.length, 5);
  assert.equal(ctx.view.editor.kind, "subscription-form");
  const creating = await buildContext({ ...deps, hash: "#/movimientos", view: {}, editors: [{ kind: "entry-new", object_id: null, dirty: true, fields: { amount: "-3" } }] });
  assert.deepEqual(creating.active_objects, []);
  assert.deepEqual(creating.view.editor.fields, { amount: "-3" });
});

test("shared expenses view returns the person being settled", async () => {
  const ctx = await buildContext({ ...deps, hash: "#/compartidos", editors: [], view: { person: "p_ana" } });
  assert.deepEqual(ids(ctx), ["person:p_ana"]);
  assert.equal(ctx.active_objects[0].balance_cents, 2500);
});

test("pages and forms answer the context request", () => {
  const target = new EventTarget();
  registerProvider(() => ({ view: { month: "2026-10" }, editors: [{ kind: "entry-form", object_id: "e1" }, null] }), target);
  registerProvider(() => ({ editors: [{ kind: "account-new", object_id: null }] }), target);
  registerProvider(() => { throw new Error("a broken provider must not break the others"); }, target);
  const { editors, view } = collectContext(target);
  assert.deepEqual(editors.map((e) => e.kind).sort(), ["account-new", "entry-form"]);
  assert.equal(view.month, "2026-10");
});

test("turn end (event and callback) refreshes once", async () => {
  const target = new EventTarget();
  installCopilot(target);
  assert.equal(typeof target.hoardCopilot.context, "function");
  let calls = 0;
  const off = subscribeRefresh(() => { calls += 1; });
  target.dispatchEvent(new Event("hoard:copilot-turn-end"));
  target.hoardCopilot.onTurnEnd();
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(calls, 1);
  off();
});
