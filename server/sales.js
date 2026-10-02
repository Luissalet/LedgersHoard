// Income from the sales of a Mercator import: one income movement per currency and day, idempotent by batch and line.
import { db, now, transaction } from "./db.js";
import { parseAmount, formatCents } from "./money.js";
import { parseDate, today } from "./dates.js";
import { createEntry } from "./entries.js";
import { listAccounts, resolveAccountFuzzy } from "./accounts.js";
import { listCategories, resolveCategory } from "./categories.js";
import { callApp, linkRefs, txRef } from "./family.js";
import { fold } from "./mail-merchants.js";

const fail = (message, status = 400, extra = {}) => { throw Object.assign(new Error(message), { status, ...extra }); };
const SALES_WORDS = /\b(ventas?|sales|ingresos? por ventas|tienda)\b/;

function incomeCategory(ref) {
  if (ref) {
    const found = resolveCategory(ref, "income");
    if (!found.category) fail(`Categoría "${ref}" no encontrada o ambigua.`, 400, { candidates: found.candidates });
    return found.category;
  }
  return listCategories({ includeArchived: false }).find((c) => c.kind === "income" && SALES_WORDS.test(fold(c.name))) || null;
}

/** Account for a currency: the one asked for, else the only active account of that currency. */
function accountFor(currency, ref) {
  if (ref) {
    const { account, candidates } = resolveAccountFuzzy(ref);
    if (!account) fail(`Cuenta "${ref}" no encontrada o ambigua.`, 400, { candidates });
    return account.currency === currency ? { account } : { account: null, reason: `la cuenta ${account.name} es en ${account.currency}` };
  }
  const active = listAccounts({ includeArchived: false }).filter((a) => a.currency === currency);
  if (active.length === 1) return { account: active[0] };
  return { account: null, reason: active.length ? `hay varias cuentas en ${currency}: indica una` : `no hay ninguna cuenta en ${currency}` };
}

/** Book the lines of a Mercator sales batch as income. Lines already booked are skipped, so repeating it adds nothing. */
export async function incomeFromSales({ batch, account = "", category = "" }) {
  const name = String(batch || "").trim();
  if (!name) fail("Falta el lote (batch).");
  const got = await callApp("mercator", "sales_batch_get", { batch: name }, { timeoutMs: 30000 });
  if (!got.ok) return { ok: false, batch: name, error: `Mercator: ${got.error}`, created: [], skipped: [] };
  const lines = Array.isArray(got.result?.lines) ? got.result.lines : [];
  const cat = incomeCategory(category);
  const known = new Set(db().prepare("SELECT line FROM sales_lines WHERE batch = ?").all(name).map((r) => r.line));
  const skipped = [];
  const groups = new Map();
  for (const l of lines) {
    const number = Number(l.line);
    if (!Number.isInteger(number) || number < 1) { skipped.push({ line: l.line ?? null, reason: "línea sin número" }); continue; }
    if (known.has(number)) { skipped.push({ line: number, reason: "ya apuntada" }); continue; }
    const cents = parseAmount(l.amount);
    if (cents === null || cents <= 0) { skipped.push({ line: number, reason: "importe no válido" }); continue; }
    const currency = String(l.currency || "EUR").trim().toUpperCase();
    const date = parseDate(String(l.sold_at || l.date || "")) || today();
    const key = `${currency}|${date}`;
    if (!groups.has(key)) groups.set(key, { currency, date, cents: 0, lines: [], products: [] });
    const g = groups.get(key);
    g.cents += cents;
    g.lines.push(number);
    if (l.product) g.products.push(String(l.product));
  }
  const created = [];
  transaction(() => {
    for (const g of groups.values()) {
      const chosen = accountFor(g.currency, account);
      if (!chosen.account) { for (const n of g.lines) skipped.push({ line: n, reason: chosen.reason }); continue; }
      const products = [...new Set(g.products)].slice(0, 6).join(", ");
      const entry = createEntry({
        date: g.date, amount_cents: g.cents, account_id: chosen.account.id, category_id: cat?.id || null, counterparty: "Ventas",
        note: `Lote ${name}, líneas ${g.lines.join(", ")}${products ? ` · ${products}` : ""}`.slice(0, 1000), tags: ["ventas"], source: "agent", source_ref: `sales:${name}:${g.currency}:${g.date}`,
      });
      const mark = db().prepare("INSERT OR IGNORE INTO sales_lines (batch, line, entry_id, created_at) VALUES (?, ?, ?, ?)");
      for (const n of g.lines) mark.run(name, n, entry.id, now());
      created.push({ tx_id: entry.id, date: g.date, currency: g.currency, amount_cents: g.cents, amount: formatCents(g.cents), lines: g.lines, account: chosen.account.name });
    }
  });
  for (const c of created) linkRefs(txRef(c.tx_id), `hoard://mercator/sales/${name}`, "income", { fromLabel: `Ventas ${c.amount}`, toLabel: `Lote ${name}` });
  return { ok: true, batch: name, lines: lines.length, created, skipped, ...(created.length ? {} : { note: "No se ha apuntado nada nuevo." }) };
}
