// Helpers shared by the tool lists (agent-tools.js and mail-tools.js).
import { z } from "zod";
import * as accounts from "./accounts.js";
import * as categories from "./categories.js";
import { parseAmount, formatCents } from "./money.js";

export const fail = (message, extra = {}) => { throw Object.assign(new Error(message), { status: 400, ...extra }); };

export const monthField = z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM").optional();
export const amountField = z.union([z.string(), z.number()]).describe('Amount as the user wrote it: "12,50", "1.234,56", "-3", "12.5"');

export const NO_ACCOUNTS = "No hay cuentas todavía. Crea una con upsert_account (por ejemplo name: \"Efectivo\", type: \"cash\") y repite la operación.";

/**
 * Account by name/id with fuzzy matching (accent-insensitive, unique prefix or
 * substring). With no reference: the only active account is used; several
 * active accounts or none → error with candidates so the assistant asks.
 */
export function resolveAccountOrFail(ref, { required = true } = {}) {
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

export function resolveCategoryOrFail(ref, { kind = null, create = false } = {}) {
  if (!ref) return null;
  const { category, candidates } = categories.resolveCategory(ref, kind);
  if (category) return category;
  if (candidates.length) fail(`Categoría "${ref}" ambigua: ${candidates.join(", ")}. Pregunta al usuario cuál.`, { candidates });
  if (create) return categories.createCategory({ name: String(ref).trim(), kind: kind || "expense" });
  fail(`Categoría "${ref}" no existe. Pide confirmación y repite con create_category: true, o usa una existente: ${categories.listCategories({ includeArchived: false }).map((c) => c.name).join(", ")}.`, { candidates: [] });
}

export function parseAmountOrFail(text) {
  const cents = parseAmount(text);
  if (cents === null || cents === 0) fail(`Importe no reconocido: "${text}". Usa por ejemplo "12,50" o "-3".`);
  return cents;
}

export function signedAmount(cents, kind, category) {
  if (kind === "expense") return -Math.abs(cents);
  if (kind === "income") return Math.abs(cents);
  if (cents < 0) return cents;
  return category?.kind === "income" ? Math.abs(cents) : -Math.abs(cents);
}

export const present = (e) => e && ({ ...e, amount: formatCents(e.amount_cents) });

export const tool = (name, description, schema, hints, run) => ({
  name,
  description,
  schema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, ...hints },
  run,
});
export const RO = { readOnlyHint: true, idempotentHint: true };
