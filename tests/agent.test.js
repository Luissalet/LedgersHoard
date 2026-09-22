import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootServer, SAMPLE_CSV } from "./helpers.js";
import { TOOLS } from "../server/agent-tools.js";

const EXPECTED = ["list_accounts", "upsert_account", "list_categories", "add_entry", "list_entries", "search_entries", "summary", "budget_status", "months_report", "balance", "update_entry", "delete_entry", "upsert_category", "set_budget", "import_csv_preview", "import_csv_commit", "transfer"];

let s;
before(async () => { s = await bootServer(); });
after(async () => { await s.stop(); });

test("tool list is public and complete, with Spanish synonyms", async () => {
  const r = await s.call("GET", "/api/agent/tools");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.tools.map((t) => t.name), EXPECTED);
  assert.ok(r.body.instructions.length > 100);
  for (const t of r.body.tools) {
    assert.match(t.description, /\nSinónimos: /, `${t.name} has a Sinónimos line`);
    assert.equal(t.inputSchema.type, "object");
    assert.ok(t.annotations && typeof t.annotations.readOnlyHint === "boolean");
  }
  assert.equal(r.body.tools.find((t) => t.name === "delete_entry").annotations.destructiveHint, true);
  assert.equal(TOOLS.length, EXPECTED.length);
});

test("agent/call requires the bearer token from the data dir", async () => {
  assert.equal((await s.call("POST", "/api/agent/call", { name: "list_accounts", arguments: {} })).status, 401);
  assert.equal((await s.call("POST", "/api/agent/call", { name: "list_accounts", arguments: {} }, { Authorization: "Bearer nope" })).status, 401);
  const token = fs.readFileSync(path.join(s.dataDir, "mcp-token"), "utf8").trim();
  assert.equal(token, s.token);
  assert.equal(token.length, 64);
  const ok = await s.call("POST", "/api/agent/call", { name: "list_accounts", arguments: {} }, { Authorization: `Bearer ${token}` });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { accounts: [] });
  assert.equal((await s.agent("nope", {})).status, 404);
  assert.equal((await s.agent("add_entry", {})).status, 400);
});

test("upsert_account creates, then updates idempotently by name", async () => {
  const none = await s.agent("add_entry", { amount: "12,50" });
  assert.equal(none.status, 400, "no accounts yet");
  assert.match(none.body.error, /upsert_account/);
  assert.match((await s.agent("transfer", { from_account: "a", to_account: "b", amount: "1" })).body.error, /upsert_account/);
  const created = await s.agent("upsert_account", { name: "Banco Ficticio", type: "bank", opening_balance: "1.200,50" });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal(created.body.created, true);
  assert.equal(created.body.account.opening_balance, 120050);
  assert.equal(created.body.account.currency, "EUR");
  assert.equal(created.body.account.balance_text, "1.200,50 €");
  const again = await s.agent("upsert_account", { name: "banco ficticio", type: "savings" });
  assert.equal(again.body.created, false);
  assert.equal(again.body.account.id, created.body.account.id);
  assert.equal(again.body.account.type, "savings");
  assert.equal(again.body.account.opening_balance, 120050, "fields not passed are untouched");
  assert.equal((await s.agent("upsert_account", { name: "X", type: "wallet" })).status, 400);
  assert.equal((await s.agent("upsert_account", { name: "X", opening_balance: "abc" })).status, 400);
  assert.equal((await s.agent("list_accounts", {})).body.accounts.length, 1);
});

test("add_entry resolves account and category and reports the stored entry", async () => {
  const r = await s.agent("add_entry", { amount: "12,50", category: "comida", counterparty: "Frutería Ejemplo", tags: ["semana"] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.entry.amount_cents, -1250);
  assert.equal(r.body.entry.amount, "-12,50 €");
  assert.equal(r.body.entry.source, "agent");
  assert.equal(r.body.account.name, "Banco Ficticio");
  assert.equal(r.body.category.name, "Comida");
  const income = await s.agent("add_entry", { amount: "1.500,00", category: "nómina", date: "05/09/2026" });
  assert.equal(income.body.entry.amount_cents, 150000, "positive amount with income category stays income");
  assert.equal(income.body.entry.date, "2026-09-05");
  const forced = await s.agent("add_entry", { amount: "20", kind: "income", account: "banco" });
  assert.equal(forced.body.entry.amount_cents, 2000);
  const missing = await s.agent("add_entry", { amount: "3", category: "Videojuegos" });
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /create_category/);
  const created = await s.agent("add_entry", { amount: "3", category: "Videojuegos", create_category: true });
  assert.equal(created.body.category.name, "Videojuegos");
  const ambiguous = await s.agent("add_entry", { amount: "3", category: "otros" });
  assert.equal(ambiguous.status, 400);
  assert.deepEqual(ambiguous.body.candidates.sort(), ["Otros gastos", "Otros ingresos"]);
  const single = await s.agent("add_entry", { amount: "1", counterparty: "única cuenta" });
  assert.equal(single.body.account.name, "Banco Ficticio", "the only account is used without asking");
  await s.agent("upsert_account", { name: "Efectivo", type: "cash" });
  const which = await s.agent("add_entry", { amount: "3" });
  assert.equal(which.status, 400);
  assert.deepEqual(which.body.candidates, ["Banco Ficticio", "Efectivo"]);
  assert.equal((await s.agent("add_entry", { amount: "3", account: "efectívo" })).body.account.name, "Efectivo", "accent-insensitive");
  assert.equal((await s.agent("add_entry", { amount: "3", account: "efe" })).body.account.name, "Efectivo", "unique prefix");
  assert.equal((await s.agent("add_entry", { amount: "3", account: "ficticio" })).body.account.name, "Banco Ficticio", "unique substring");
  const unknown = await s.agent("add_entry", { amount: "3", account: "Tarjeta" });
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.error, /upsert_account/);
  await s.agent("upsert_account", { name: "Efectivo secundario", type: "cash" });
  const twoCash = await s.agent("add_entry", { amount: "3", account: "efec" });
  assert.equal(twoCash.status, 400);
  assert.deepEqual(twoCash.body.candidates.sort(), ["Efectivo", "Efectivo secundario"]);
  assert.equal((await s.agent("add_entry", { amount: "3", account: "Efectivo" })).body.account.name, "Efectivo", "exact name wins over prefix");
  await s.agent("upsert_account", { name: "Efectivo secundario", archived: true });
});

test("read tools: list, search, summary, budget, months, balance", async () => {
  assert.equal((await s.agent("list_entries", { account: "banco", limit: 10 })).body.items.length, 6);
  assert.equal((await s.agent("search_entries", { query: "fruter" })).body.total, 1);
  const budget = await s.agent("set_budget", { category: "Comida", amount: "10" });
  assert.equal(budget.body.category.monthly_budget, 1000);
  assert.equal(budget.body.status.over, true);
  const status = await s.agent("budget_status", {});
  assert.match(status.body.verdict, /Comida/);
  const summary = await s.agent("summary", {});
  assert.equal(summary.body.income_text, "1.520,00 €");
  const months = await s.agent("months_report", {});
  assert.equal(months.body.months.length, 12);
  const balance = await s.agent("balance", { account: "Banco" });
  assert.equal(balance.body.balance, 120050 - 1250 + 150000 + 2000 - 300 - 100 - 300);
  assert.equal((await s.agent("balance", {})).body.accounts.length, 3);
  assert.equal((await s.agent("set_budget", { category: "Nómina", amount: "10" })).status, 400);
});

test("update, transfer, upsert_category and delete", async () => {
  const entry = (await s.agent("search_entries", { query: "fruter" })).body.items[0];
  const upd = await s.agent("update_entry", { id: entry.id, amount: "14", note: "corregido" });
  assert.equal(upd.body.entry.amount_cents, -1400);
  assert.equal(upd.body.entry.note, "corregido");
  const t = await s.agent("transfer", { from_account: "Banco", to_account: "Efectivo", amount: "200" });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  assert.equal(t.body.out.amount_cents, -20000);
  assert.equal((await s.agent("balance", { account: "Efectivo" })).body.balance, 20000 - 300 - 300 - 300, "transfer in minus the three cash entries");
  const up = await s.agent("upsert_category", { name: "Mascotas", monthly_budget: "50" });
  assert.equal(up.body.created, true);
  const again = await s.agent("upsert_category", { name: "mascotas", color: "#123456" });
  assert.equal(again.body.created, false);
  assert.equal(again.body.category.color, "#123456");
  const del = await s.agent("delete_entry", { id: entry.id });
  assert.equal(del.body.deleted.id, entry.id);
  assert.equal((await s.agent("delete_entry", { id: entry.id })).status, 404);
});

test("CSV import through the agent dedupes on the second commit", async () => {
  const preview = await s.agent("import_csv_preview", { csv: SAMPLE_CSV, account: "Banco" });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.rows_new, 3);
  const first = await s.agent("import_csv_commit", { csv: SAMPLE_CSV, mapping: preview.body.mapping, account: "Banco" });
  assert.equal(first.body.rows_added, 3);
  const second = await s.agent("import_csv_commit", { csv: SAMPLE_CSV, mapping: preview.body.mapping, account: "Banco" });
  assert.equal(second.body.rows_added, 0);
  assert.equal(second.body.rows_skipped, 3);
});
