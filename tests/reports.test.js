import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { init, close } from "../server/db.js";
import { seedCategories, createCategory, updateCategory, listCategories, resolveCategory, DEFAULT_CATEGORIES } from "../server/categories.js";
import { createAccount, accountBalance, resolveAccount } from "../server/accounts.js";
import { createEntry, createTransfer, deleteEntry, listEntries } from "../server/entries.js";
import { summary, budgetStatus, monthsReport } from "../server/reports.js";
import { tempDir } from "./helpers.js";

let dir, bank, cash, comida, casa, nomina;

before(() => {
  dir = tempDir();
  init(dir);
  assert.equal(seedCategories(), DEFAULT_CATEGORIES.length);
  assert.equal(seedCategories(), 0, "seed runs only once");
  bank = createAccount({ name: "Banco Ficticio", type: "bank", opening_balance: 100000 });
  cash = createAccount({ name: "Efectivo", type: "cash" });
  comida = updateCategory(resolveCategory("Comida").category.id, { monthly_budget: 30000 });
  casa = resolveCategory("Casa").category;
  nomina = resolveCategory("Nómina").category;
  createEntry({ date: "2026-09-02", amount_cents: -12050, account_id: bank.id, category_id: comida.id, counterparty: "Super Ejemplo" });
  createEntry({ date: "2026-09-10", amount_cents: -20000, account_id: cash.id, category_id: comida.id, counterparty: "Mercado" });
  createEntry({ date: "2026-09-15", amount_cents: -50000, account_id: bank.id, category_id: casa.id, counterparty: "Alquiler ejemplo" });
  createEntry({ date: "2026-09-25", amount_cents: 180000, account_id: bank.id, category_id: nomina.id, counterparty: "Empresa Ficticia" });
  createEntry({ date: "2026-09-26", amount_cents: -999, account_id: bank.id, category_id: null, counterparty: "Sin categoría" });
  createEntry({ date: "2026-08-20", amount_cents: -7000, account_id: bank.id, category_id: comida.id });
  createTransfer({ from_account_id: bank.id, to_account_id: cash.id, amount_cents: 20000, date: "2026-09-05" });
});
after(() => { close(); fs.rmSync(dir, { recursive: true, force: true }); });

test("summary totals exclude transfers and split income/expense", () => {
  const s = summary("2026-09");
  assert.equal(s.income, 180000);
  assert.equal(s.expense, 12050 + 20000 + 50000 + 999);
  assert.equal(s.net, s.income - s.expense);
  const line = s.categories.find((c) => c.id === comida.id);
  assert.equal(line.spent, 32050);
  assert.equal(line.budget, 30000);
  assert.equal(line.over, true);
  assert.equal(line.pct, 107);
  const casaLine = s.categories.find((c) => c.id === casa.id);
  assert.equal(casaLine.budget, null, "categories without budget carry null");
  assert.equal(casaLine.over, false);
  const income = s.categories.find((c) => c.id === nomina.id);
  assert.equal(income.earned, 180000);
  assert.equal(income.budget, null, "income never has a budget");
  assert.ok(s.categories.find((c) => c.id === null && c.spent === 999), "uncategorised line present");
  assert.equal(s.budget.total, 30000);
  assert.equal(s.budget.spent, 32050);
  assert.equal(s.budget.over, 1);
});

test("budget_status only lists expense categories and gives a verdict", () => {
  const b = budgetStatus("2026-09");
  assert.ok(b.categories.every((c) => c.id !== nomina.id));
  const line = b.categories.find((c) => c.id === comida.id);
  assert.equal(line.remaining, -2050);
  assert.equal(b.over_count, 1);
  assert.match(b.verdict, /Comida/);
  assert.match(b.verdict, /320,50 €/);
  const empty = budgetStatus("2025-01");
  assert.equal(empty.over_count, 0);
  assert.match(budgetStatus("2026-08").verdict, /dentro de presupuesto/);
});

test("account balances include opening balance and transfers", () => {
  assert.equal(accountBalance(bank.id), 100000 - 12050 - 50000 + 180000 - 999 - 7000 - 20000);
  assert.equal(accountBalance(cash.id), -20000 + 20000);
  assert.equal(accountBalance(bank.id, "2026-08-31"), 100000 - 7000);
  assert.equal(resolveAccount("banco").id, bank.id);
  assert.equal(resolveAccount("BANCO FICTICIO").id, bank.id);
  assert.equal(resolveAccount("nada"), null);
});

test("months report fills empty months", () => {
  const rows = monthsReport("2026-07", "2026-09");
  assert.deepEqual(rows.map((r) => r.month), ["2026-07", "2026-08", "2026-09"]);
  assert.deepEqual(rows[0], { month: "2026-07", income: 0, expense: 0, net: 0 });
  assert.equal(rows[1].expense, 7000);
  assert.equal(rows[2].income, 180000);
});

test("category fuzzy matching and ambiguity", () => {
  assert.equal(resolveCategory("comida").category.id, comida.id);
  assert.equal(resolveCategory("nomina").category.id, nomina.id);
  assert.equal(resolveCategory("otros").category, null);
  assert.deepEqual(resolveCategory("otros").candidates.sort(), ["Otros gastos", "Otros ingresos"]);
  assert.equal(resolveCategory("otros", "income").category.name, "Otros ingresos");
  createCategory({ name: "Comida fuera", parent_id: comida.id });
  assert.equal(resolveCategory("Comida").category.id, comida.id, "exact name wins over prefix");
  assert.equal(resolveCategory("fuera").category.name, "Comida fuera");
  assert.equal(listCategories().length, DEFAULT_CATEGORIES.length + 1);
});

test("filters, search and transfer deletion", () => {
  assert.equal(listEntries({ text: "Super" }).total, 1);
  assert.equal(listEntries({ category: "none" }).total, 3, "uncategorised entry plus the two transfer halves");
  assert.equal(listEntries({ account: cash.id }).total, 2);
  assert.equal(listEntries({ from: "2026-09-01", to: "2026-09-30", tag: "traspaso" }).total, 2);
  const half = listEntries({ tag: "traspaso" }).items[0];
  assert.equal(deleteEntry(half.id), true);
  assert.equal(listEntries({ tag: "traspaso" }).total, 0, "both halves removed");
  assert.throws(() => createEntry({ date: "2026-09-01", amount_cents: 0, account_id: bank.id }), /cero/);
  assert.throws(() => createEntry({ date: "nope", amount_cents: 100, account_id: bank.id }), /Fecha/);
});
