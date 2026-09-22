import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { bootServer, SAMPLE_CSV } from "./helpers.js";

let s, account;
before(async () => { s = await bootServer(); });
after(async () => { await s.stop(); });

test("health and state bootstrap", async () => {
  const health = await s.call("GET", "/api/health");
  assert.equal(health.status, 200);
  assert.deepEqual(Object.keys(health.body).sort(), ["dataDirConfigured", "service", "version"]);
  assert.equal(health.body.service, "ledgers-hoard");
  const state = await s.call("GET", "/api/state");
  assert.equal(state.status, 200);
  assert.equal(state.body.accounts.length, 0);
  assert.ok(state.body.categories.some((c) => c.name === "Comida"), "seeded categories present");
  assert.equal(state.body.settings.currency_symbol, "€");
  assert.equal(state.body.dataDir, s.dataDir);
});

test("accounts CRUD with validation", async () => {
  const bad = await s.call("POST", "/api/accounts", { name: "", type: "wallet" });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.error);
  const created = await s.call("POST", "/api/accounts", { name: "Banco Ficticio", type: "bank", opening_balance: 50000 });
  assert.equal(created.status, 201);
  account = created.body;
  const dup = await s.call("POST", "/api/accounts", { name: "banco ficticio" });
  assert.equal(dup.status, 409);
  const patched = await s.call("PATCH", `/api/accounts/${account.id}`, { type: "savings" });
  assert.equal(patched.body.type, "savings");
  assert.equal((await s.call("PATCH", "/api/accounts/nope", { name: "x" })).status, 404);
});

test("entries round-trip, filters and summary", async () => {
  const cats = (await s.call("GET", "/api/categories")).body;
  const comida = cats.find((c) => c.name === "Comida");
  const nomina = cats.find((c) => c.name === "Nómina");
  await s.call("PATCH", `/api/categories/${comida.id}`, { monthly_budget: 20000 });
  const e1 = await s.call("POST", "/api/entries", { date: "2026-09-03", amount: "-12,50", account_id: account.id, category_id: comida.id, counterparty: "Panadería Ejemplo" });
  assert.equal(e1.status, 201);
  assert.equal(e1.body.amount_cents, -1250);
  const e2 = await s.call("POST", "/api/entries", { date: "2026-09-25", amount_cents: 150000, account_id: account.id, category_id: nomina.id, counterparty: "Empresa Ficticia" });
  assert.equal(e2.status, 201);
  assert.equal((await s.call("POST", "/api/entries", { date: "2026-09-03", amount: "abc", account_id: account.id })).status, 400);
  assert.equal((await s.call("POST", "/api/entries", { date: "2026-09-03", amount_cents: -100, account_id: "missing" })).status, 400);
  const list = await s.call("GET", `/api/entries?from=2026-09-01&to=2026-09-30&account=${account.id}`);
  assert.equal(list.body.total, 2);
  assert.equal((await s.call("GET", "/api/entries?text=panad")).body.total, 1);
  const upd = await s.call("PATCH", `/api/entries/${e1.body.id}`, { amount: "-13,00", note: "pan" });
  assert.equal(upd.body.amount_cents, -1300);
  assert.equal(upd.body.counterparty, "Panadería Ejemplo", "patch keeps untouched fields");
  assert.equal(upd.body.category_id, comida.id);
  assert.equal(upd.body.date, "2026-09-03");
  const summary = await s.call("GET", "/api/summary?month=2026-09");
  assert.equal(summary.body.income, 150000);
  assert.equal(summary.body.expense, 1300);
  assert.equal(summary.body.net, 148700);
  const line = summary.body.categories.find((c) => c.id === comida.id);
  assert.equal(line.budget, 20000);
  assert.equal(line.spent, 1300);
  assert.equal(line.over, false);
  assert.equal(summary.body.accounts[0].balance, 50000 - 1300 + 150000);
  assert.equal((await s.call("GET", "/api/summary?month=2026-13")).status, 400);
  const months = await s.call("GET", "/api/reports/months?from=2026-08&to=2026-09");
  assert.equal(months.body.months.length, 2);
  assert.equal(months.body.months[1].net, 148700);
  const del = await s.call("DELETE", `/api/entries/${e1.body.id}`);
  assert.equal(del.body.ok, true);
  assert.equal((await s.call("GET", `/api/entries/${e1.body.id}`)).status, 404);
});

test("transfers create two linked entries excluded from totals", async () => {
  const cash = (await s.call("POST", "/api/accounts", { name: "Efectivo", type: "cash" })).body;
  const t = await s.call("POST", "/api/transfers", { from_account_id: account.id, to_account_id: cash.id, amount: "200", date: "2026-09-10" });
  assert.equal(t.status, 201);
  assert.equal(t.body.out.amount_cents, -20000);
  assert.equal(t.body.in.amount_cents, 20000);
  assert.equal(t.body.out.transfer_id, t.body.in.transfer_id);
  const summary = (await s.call("GET", "/api/summary?month=2026-09")).body;
  assert.equal(summary.expense, 0);
  assert.equal(summary.accounts.find((a) => a.id === cash.id).balance, 20000);
  assert.equal((await s.call("POST", "/api/transfers", { from_account_id: cash.id, to_account_id: cash.id, amount: "5" })).status, 400);
});

test("import preview then commit twice — second commit skips everything", async () => {
  const preview = await s.call("POST", "/api/imports/preview", { csv: SAMPLE_CSV, account_id: account.id });
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.body.columns, ["Fecha", "Concepto", "Importe", "Saldo"]);
  assert.equal(preview.body.mapping.date, "Fecha");
  assert.equal(preview.body.mapping.amount, "Importe");
  assert.equal(preview.body.rows_total, 3);
  assert.equal(preview.body.rows_new, 3);
  assert.equal(preview.body.rows_duplicate, 0);
  assert.equal(preview.body.sample.length, 3);
  assert.equal(preview.body.sample[1].amount_cents, 150000);

  const first = await s.call("POST", "/api/imports/commit", { csv: SAMPLE_CSV, mapping: preview.body.mapping, account_id: account.id, filename: "extracto.csv" });
  assert.equal(first.status, 201);
  assert.equal(first.body.rows_added, 3);
  assert.equal(first.body.rows_skipped, 0);
  assert.ok(first.body.entries.every((e) => e.source === "import" && e.import_hash));

  const again = await s.call("POST", "/api/imports/preview", { csv: SAMPLE_CSV, account_id: account.id });
  assert.equal(again.body.rows_duplicate, 3);
  const second = await s.call("POST", "/api/imports/commit", { csv: SAMPLE_CSV, mapping: preview.body.mapping, account_id: account.id });
  assert.equal(second.body.rows_added, 0);
  assert.equal(second.body.rows_skipped, 3);
  assert.equal((await s.call("GET", "/api/entries?source=import")).body.total, 3);
  const history = await s.call("GET", "/api/imports");
  assert.equal(history.body.length, 2);
  assert.equal(history.body[1].filename, "extracto.csv");
  assert.equal((await s.call("POST", "/api/imports/commit", { csv: SAMPLE_CSV })).status, 400);
});

test("unknown API routes and bad JSON answer with { error }", async () => {
  assert.equal((await s.call("GET", "/api/nothing")).status, 404);
  const response = await fetch(`${s.base}/api/entries`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{oops" });
  assert.equal(response.status, 400);
  assert.ok((await response.json()).error);
});
