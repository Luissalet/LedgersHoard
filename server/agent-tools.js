// Tools exposed to the assistant. One list drives /api/agent/call and the
// MCP bridge (server/mcp.js). Descriptions end with a "Sinónimos:" line of
// Spanish words for the client's tool index.
import { z } from "zod";
import * as accounts from "./accounts.js";
import * as categories from "./categories.js";
import * as entries from "./entries.js";
import * as reports from "./reports.js";
import { previewImport, commitImport, mappingSchema } from "./imports.js";
import { parseAmount, formatCents } from "./money.js";
import { parseDate, today, thisMonth, isMonth, addMonths } from "./dates.js";

export const AGENT_INSTRUCTIONS = `Ledger's Hoard is the user's household ledger (accounts, categories, entries, budgets, CSV imports). Amounts are integer cents in tool results; format them for the user as "12,50 €".
Read before you write: call list_accounts and list_categories once per session before add_entry, transfer or set_budget.
Accounts are created with upsert_account (idempotent by name, case/accent-insensitive). If add_entry or transfer report that there are no accounts, call upsert_account first and retry. When exactly one account exists, add_entry uses it without asking.
Never guess an amount, a date or an account. If the user did not say the amount, ask. Negative = expense, positive = income.
When an account or category is ambiguous the tool returns candidates: ask the user which one instead of picking. Create a category only when the user asks for it (create_category: true).
After add_entry, update_entry or transfer, report the stored entry back verbatim (date, amount, account, category, counterparty).
Months are YYYY-MM, dates are YYYY-MM-DD. Default month is the current one. delete_entry is irreversible: confirm first.
Imports: run import_csv_preview, show the mapping and the duplicate count, and only then import_csv_commit with the same csv and mapping. Duplicates are skipped by hash, so committing twice is safe.`;

const fail = (message, extra = {}) => { throw Object.assign(new Error(message), { status: 400, ...extra }); };

const monthField = z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM").optional();
const amountField = z.union([z.string(), z.number()]).describe('Amount as the user wrote it: "12,50", "1.234,56", "-3", "12.5"');

const NO_ACCOUNTS = "No hay cuentas todavía. Crea una con upsert_account (por ejemplo name: \"Efectivo\", type: \"cash\") y repite la operación.";

/**
 * Account by name/id with fuzzy matching (accent-insensitive, unique prefix or
 * substring). With no reference: the only active account is used; several
 * active accounts or none → error with candidates so the assistant asks.
 */
function resolveAccountOrFail(ref, { required = true } = {}) {
  const active = accounts.listAccounts({ includeArchived: false });
  if (!active.length) {
    const archived = accounts.listAccounts().map((a) => a.name);
    fail(archived.length ? `Todas las cuentas están archivadas (${archived.join(", ")}). Recupera una con upsert_account (archived: false) o crea otra.` : NO_ACCOUNTS, { candidates: [] });
  }
  if (!ref) {
    if (active.length === 1) return active[0];
    if (!required) return null;
    fail(`Indica la cuenta. Cuentas: ${active.map((a) => a.name).join(", ")}.`, { candidates: active.map((a) => a.name) });
  }
  const { account, candidates } = accounts.resolveAccountFuzzy(ref);
  if (account) return account;
  if (candidates.length) fail(`Cuenta "${ref}" ambigua: ${candidates.join(", ")}. Pregunta al usuario cuál.`, { candidates });
  fail(`Cuenta "${ref}" no encontrada. Cuentas: ${active.map((a) => a.name).join(", ") || "ninguna"}. Si el usuario quiere crearla, usa upsert_account.`, { candidates: [] });
}

function resolveCategoryOrFail(ref, { kind = null, create = false } = {}) {
  if (!ref) return null;
  const { category, candidates } = categories.resolveCategory(ref, kind);
  if (category) return category;
  if (candidates.length) fail(`Categoría "${ref}" ambigua: ${candidates.join(", ")}. Pregunta al usuario cuál.`, { candidates });
  if (create) return categories.createCategory({ name: String(ref).trim(), kind: kind || "expense" });
  fail(`Categoría "${ref}" no existe. Pide confirmación y repite con create_category: true, o usa una existente: ${categories.listCategories({ includeArchived: false }).map((c) => c.name).join(", ")}.`, { candidates: [] });
}

function parseAmountOrFail(text) {
  const cents = parseAmount(text);
  if (cents === null || cents === 0) fail(`Importe no reconocido: "${text}". Usa por ejemplo "12,50" o "-3".`);
  return cents;
}

function signedAmount(cents, kind, category) {
  if (kind === "expense") return -Math.abs(cents);
  if (kind === "income") return Math.abs(cents);
  if (cents < 0) return cents;
  return category?.kind === "income" ? Math.abs(cents) : -Math.abs(cents);
}

const present = (e) => e && ({ ...e, amount: formatCents(e.amount_cents) });

const tool = (name, description, schema, hints, run) => ({
  name,
  description,
  schema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, ...hints },
  run,
});
const RO = { readOnlyHint: true, idempotentHint: true };

export const TOOLS = [
  tool("list_accounts",
    "List the user's accounts (cash, bank, card, savings, other) with currency and current balance in cents. Call before adding entries.\nSinónimos: cuentas, saldo, banco, efectivo, tarjeta, ahorros, cuánto tengo, dinero en el banco",
    z.object({ include_archived: z.boolean().default(false) }), RO,
    ({ include_archived }) => ({ accounts: accounts.accountBalances().filter((a) => include_archived || !a.archived).map((a) => ({ ...a, balance_text: formatCents(a.balance, a.currency === "EUR" ? "€" : a.currency) })) })),

  tool("upsert_account",
    'Create an account, or update the one with the same name (case/accent-insensitive). type: cash|bank|card|savings|other (default bank). currency defaults to EUR. opening_balance as text ("150", "1.200,50"): the real balance when you start tracking. Idempotent: calling it again with the same name updates only the fields you pass. Returns { created, account }.\nSinónimos: crear cuenta, nueva cuenta, cuenta de efectivo, cuenta del banco, tarjeta, cuenta de ahorro, saldo inicial, renombrar cuenta, archivar cuenta',
    z.object({
      name: z.string().trim().min(1).max(80),
      type: z.enum(accounts.ACCOUNT_TYPES).optional(),
      currency: z.string().trim().length(3).optional(),
      opening_balance: amountField.optional(),
      archived: z.boolean().optional(),
    }), { idempotentHint: true },
    (a) => {
      const input = { name: a.name };
      if (a.type) input.type = a.type;
      if (a.currency) input.currency = a.currency.toUpperCase();
      if (a.archived !== undefined) input.archived = a.archived;
      if (a.opening_balance !== undefined) {
        const cents = parseAmount(a.opening_balance);
        if (cents === null) fail(`Saldo inicial no reconocido: "${a.opening_balance}".`);
        input.opening_balance = cents;
      }
      const out = accounts.upsertAccount(input);
      const balance = accounts.accountBalance(out.account.id);
      return { ...out, account: { ...out.account, balance, balance_text: formatCents(balance) } };
    }),

  tool("list_categories",
    "List expense and income categories with monthly budget (cents) and colour. Call before add_entry to pick the right category name.\nSinónimos: categorías, tipos de gasto, presupuesto por categoría, comida, casa, transporte, ocio, nómina",
    z.object({ kind: z.enum(["expense", "income"]).optional(), include_archived: z.boolean().default(false) }), RO,
    ({ kind, include_archived }) => ({ categories: categories.listCategories({ includeArchived: include_archived }).filter((c) => !kind || c.kind === kind) })),

  tool("add_entry",
    'Record a money movement. amount is text parsed as the user wrote it ("12,50", "1.234,56", "-3"). kind: expense (stored negative), income (positive) or auto (sign from the text; a positive amount with an income category is income, otherwise expense). account by name or id, fuzzy (accent-insensitive, unique prefix); omit it when there is only one account and it is used automatically. If there are no accounts the error says to call upsert_account first. category by name (fuzzy; created only if create_category is true). Returns the stored entry with the resolved account and category; repeat it to the user verbatim.\nSinónimos: apuntar, anotar, gasto, ingreso, he pagado, he gastado, me han pagado, nómina, compra, registrar movimiento, añadir gasto',
    z.object({
      amount: amountField,
      kind: z.enum(["expense", "income", "auto"]).default("auto"),
      date: z.string().optional().describe("YYYY-MM-DD or DD/MM/YYYY; default today"),
      account: z.string().optional().describe("Account name or id"),
      category: z.string().optional().describe("Category name (fuzzy) or id"),
      create_category: z.boolean().default(false),
      counterparty: z.string().max(200).default("").describe("Shop, person or payer"),
      note: z.string().max(2000).default(""),
      tags: z.array(z.string().max(40)).max(20).default([]),
    }), {},
    (a) => {
      const date = a.date ? parseDate(a.date) || fail(`Fecha no válida: "${a.date}".`) : today();
      const cents = parseAmountOrFail(a.amount);
      const account = resolveAccountOrFail(a.account);
      const kindHint = a.kind === "auto" ? (cents < 0 ? "expense" : null) : a.kind;
      const category = resolveCategoryOrFail(a.category, { kind: kindHint, create: a.create_category });
      const entry = entries.createEntry({
        date, amount_cents: signedAmount(cents, a.kind, category), account_id: account.id, category_id: category?.id || null,
        counterparty: a.counterparty, note: a.note, tags: a.tags, source: "agent",
      });
      return { entry: present(entry), account: { id: account.id, name: account.name }, category: category ? { id: category.id, name: category.name, kind: category.kind } : null };
    }),

  tool("list_entries",
    "List entries with filters: from/to (YYYY-MM-DD), account (name or id), category (name or id, or 'none'), text (counterparty/note), tag, limit (max 200), order asc|desc. Amounts in cents, negative = expense.\nSinónimos: movimientos, listar gastos, qué he gastado, extracto, historial, últimos movimientos, gastos de este mes",
    z.object({
      from: z.string().optional(), to: z.string().optional(), account: z.string().optional(), category: z.string().optional(),
      text: z.string().max(200).optional(), tag: z.string().max(40).optional(),
      limit: z.number().int().min(1).max(200).default(50), offset: z.number().int().min(0).default(0),
      order: z.enum(["asc", "desc"]).default("desc"),
    }), RO,
    (a) => {
      const filter = { ...a };
      if (a.account) filter.account = resolveAccountOrFail(a.account).id;
      if (a.category && a.category !== "none") filter.category = resolveCategoryOrFail(a.category).id;
      const out = entries.listEntries(filter);
      return { ...out, items: out.items.map(present) };
    }),

  tool("search_entries",
    "Free-text search over counterparty, note, tags and category name. Optional from/to and limit (max 200).\nSinónimos: buscar movimiento, encontrar gasto, cuándo pagué, buscar por concepto, buscar tienda",
    z.object({ query: z.string().trim().min(1).max(200), from: z.string().optional(), to: z.string().optional(), limit: z.number().int().min(1).max(200).default(50) }), RO,
    (a) => { const out = entries.listEntries({ text: a.query, from: a.from, to: a.to, limit: a.limit }); return { ...out, items: out.items.map(present) }; }),

  tool("summary",
    "Monthly summary (month YYYY-MM, default current): income, expense, net, per category spent vs budget, and per account balance. Transfers are excluded from totals.\nSinónimos: resumen del mes, cuánto llevo gastado, balance, cómo voy, cuánto he ingresado, gastos del mes",
    z.object({ month: monthField }), RO,
    ({ month }) => { const s = reports.summary(month || thisMonth()); return { ...s, income_text: formatCents(s.income), expense_text: formatCents(s.expense), net_text: formatCents(s.net) }; }),

  tool("budget_status",
    "Budget check for a month (default current): per expense category budget, spent, remaining, pct and over flag, plus a one-line verdict.\nSinónimos: presupuesto, me paso, cuánto me queda, límite de gasto, voy bien, presupuesto de comida",
    z.object({ month: monthField }), RO,
    ({ month }) => reports.budgetStatus(month || thisMonth())),

  tool("months_report",
    "Per-month income, expense and net between from and to (YYYY-MM, inclusive). Defaults to the last 12 months.\nSinónimos: informe mensual, evolución, comparar meses, cuánto gasto al mes, histórico, tendencia",
    z.object({ from: monthField, to: monthField }), RO,
    ({ from, to }) => {
      const end = to || thisMonth();
      const start = from || addMonths(end, -11);
      if (!isMonth(start) || !isMonth(end) || start > end) fail("Rango de meses no válido.");
      return { from: start, to: end, months: reports.monthsReport(start, end) };
    }),

  tool("balance",
    "Balance of one account (name or id) at a date (YYYY-MM-DD, default today), opening balance included. Without account returns every account.\nSinónimos: saldo, cuánto tengo, dinero en la cuenta, saldo del banco, saldo en efectivo",
    z.object({ account: z.string().optional(), at: z.string().optional() }), RO,
    ({ account, at }) => {
      const date = at ? parseDate(at) || fail(`Fecha no válida: "${at}".`) : today();
      if (!account) return { at: date, accounts: accounts.accountBalances(date).map((a) => ({ ...a, balance_text: formatCents(a.balance) })) };
      const acc = resolveAccountOrFail(account);
      const balance = accounts.accountBalance(acc.id, date);
      return { at: date, account: { id: acc.id, name: acc.name, currency: acc.currency }, balance, balance_text: formatCents(balance) };
    }),

  tool("update_entry",
    "Edit an existing entry by id: amount (text), kind, date, account, category, counterparty, note, tags. Only provided fields change.\nSinónimos: corregir, cambiar importe, editar movimiento, modificar gasto, poner categoría, mover a otra cuenta",
    z.object({
      id: z.string().min(1), amount: amountField.optional(), kind: z.enum(["expense", "income", "auto"]).default("auto"),
      date: z.string().optional(), account: z.string().optional(), category: z.string().nullable().optional(), create_category: z.boolean().default(false),
      counterparty: z.string().max(200).optional(), note: z.string().max(2000).optional(), tags: z.array(z.string().max(40)).max(20).optional(),
    }), { idempotentHint: true },
    (a) => {
      const current = entries.getEntry(a.id) || fail("El movimiento no existe.", { status: 404 });
      const patch = {};
      if (a.date) patch.date = parseDate(a.date) || fail(`Fecha no válida: "${a.date}".`);
      if (a.account) patch.account_id = resolveAccountOrFail(a.account).id;
      let category;
      if (a.category === null) { patch.category_id = null; category = null; }
      else if (a.category) { category = resolveCategoryOrFail(a.category, { create: a.create_category }); patch.category_id = category.id; }
      else category = current.category_id ? categories.getCategory(current.category_id) : null;
      if (a.amount !== undefined) patch.amount_cents = signedAmount(parseAmountOrFail(a.amount), a.kind, category);
      else if (a.kind !== "auto") patch.amount_cents = signedAmount(current.amount_cents, a.kind, category);
      for (const k of ["counterparty", "note", "tags"]) if (a[k] !== undefined) patch[k] = a[k];
      return { entry: present(entries.updateEntry(a.id, patch)) };
    }),

  tool("delete_entry",
    "Delete an entry by id. Irreversible; both halves of a transfer are removed. Confirm with the user first.\nSinónimos: borrar, eliminar movimiento, quitar gasto, deshacer apunte",
    z.object({ id: z.string().min(1) }), { destructiveHint: true, idempotentHint: true },
    ({ id }) => { const entry = entries.getEntry(id) || fail("El movimiento no existe.", { status: 404 }); entries.deleteEntry(id); return { deleted: present(entry) }; }),

  tool("upsert_category",
    "Create a category or update it by name/id: kind (expense|income), monthly_budget (text amount or null), color, parent (name or id), archived. Idempotent on name.\nSinónimos: crear categoría, nueva categoría, renombrar categoría, archivar categoría, subcategoría",
    z.object({
      name: z.string().trim().min(1).max(80), new_name: z.string().trim().min(1).max(80).optional(), kind: z.enum(["expense", "income"]).optional(),
      monthly_budget: amountField.nullable().optional(), color: z.string().max(20).nullable().optional(), parent: z.string().nullable().optional(), archived: z.boolean().optional(),
    }), { idempotentHint: true },
    (a) => {
      const patch = {};
      if (a.kind) patch.kind = a.kind;
      if (a.color !== undefined) patch.color = a.color;
      if (a.archived !== undefined) patch.archived = a.archived;
      if (a.monthly_budget !== undefined) patch.monthly_budget = a.monthly_budget === null ? null : Math.abs(parseAmountOrFail(a.monthly_budget));
      if (a.parent !== undefined) patch.parent_id = a.parent === null ? null : resolveCategoryOrFail(a.parent).id;
      const { category, candidates } = categories.resolveCategory(a.name);
      if (!category && candidates.length && !a.kind) fail(`Categoría "${a.name}" ambigua: ${candidates.join(", ")}.`, { candidates });
      if (category) return { created: false, category: categories.updateCategory(category.id, { ...patch, ...(a.new_name ? { name: a.new_name } : {}) }) };
      return { created: true, category: categories.createCategory({ name: a.name, ...patch }) };
    }),

  tool("set_budget",
    'Set the monthly budget of an expense category (category name or id, amount as text like "250" or "250,00"; null removes it). Returns the category and the current month status.\nSinónimos: presupuesto, límite mensual, poner presupuesto, tope de gasto, quiero gastar como máximo',
    z.object({ category: z.string().min(1), amount: amountField.nullable() }), { idempotentHint: true },
    ({ category, amount }) => {
      const cat = resolveCategoryOrFail(category, { kind: "expense" });
      if (cat.kind !== "expense") fail("Solo las categorías de gasto tienen presupuesto.");
      const updated = categories.updateCategory(cat.id, { monthly_budget: amount === null ? null : Math.abs(parseAmountOrFail(amount)) });
      const status = reports.budgetStatus(thisMonth()).categories.find((c) => c.id === cat.id);
      return { category: updated, status };
    }),

  tool("import_csv_preview",
    "Analyse bank statement CSV text (; or , separated, quoted fields, DD/MM/YYYY or YYYY-MM-DD dates, Spanish decimal comma, optional debit/credit columns). Returns detected columns, guessed mapping (column names for date, amount or debit+credit, description, counterparty, decimal), first 20 parsed rows and how many are duplicates for the given account. Nothing is written.\nSinónimos: importar extracto, csv del banco, previsualizar importación, extracto bancario, cargar movimientos",
    z.object({ csv: z.string().min(1), mapping: mappingSchema.optional(), account: z.string().optional() }), RO,
    ({ csv, mapping, account }) => previewImport({ csv, mapping, account_id: account ? resolveAccountOrFail(account).id : "" })),

  tool("import_csv_commit",
    "Import CSV rows into an account (name or id) using the mapping from import_csv_preview. Rows whose hash (date|amount|description|account) already exists are skipped, so re-running is safe. Returns added/skipped counts and the first entries.\nSinónimos: importar, confirmar importación, cargar extracto, meter movimientos del banco",
    z.object({ csv: z.string().min(1), mapping: mappingSchema.optional(), account: z.string().min(1), filename: z.string().max(200).default(""), category: z.string().optional() }), { idempotentHint: true },
    ({ csv, mapping, account, filename, category }) => {
      const acc = resolveAccountOrFail(account);
      const cat = category ? resolveCategoryOrFail(category) : null;
      const out = commitImport({ csv, mapping, account_id: acc.id, filename, category_id: cat?.id || null });
      return { ...out, account: { id: acc.id, name: acc.name }, entries: out.entries.map(present) };
    }),

  tool("transfer",
    'Move money between two accounts (names or ids): amount as text ("200"), date default today, note. Creates two linked entries excluded from income/expense totals.\nSinónimos: transferencia, traspaso, sacar dinero, pasar dinero, mover de cuenta, retirar del cajero, ingresar en el banco',
    z.object({ from_account: z.string().min(1), to_account: z.string().min(1), amount: amountField, date: z.string().optional(), note: z.string().max(2000).default("") }), {},
    (a) => {
      const from = resolveAccountOrFail(a.from_account);
      const to = resolveAccountOrFail(a.to_account);
      const date = a.date ? parseDate(a.date) || fail(`Fecha no válida: "${a.date}".`) : today();
      const out = entries.createTransfer({ from_account_id: from.id, to_account_id: to.id, amount_cents: Math.abs(parseAmountOrFail(a.amount)), date, note: a.note, source: "agent" });
      return { transfer_id: out.transfer_id, out: present(out.out), in: present(out.in) };
    }),
];

export function findTool(name) {
  return TOOLS.find((t) => t.name === name);
}

export async function callTool(name, args) {
  const t = findTool(name);
  if (!t) throw Object.assign(new Error("Herramienta desconocida."), { status: 404 });
  return await t.run(t.schema.parse(args || {}));
}
