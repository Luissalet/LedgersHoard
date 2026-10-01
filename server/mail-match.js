// Matching a merchant name against an entry's counterparty, and finding an
// existing entry that is the same payment (used to avoid double counting
// between mail, manual entries and bank CSV imports).
import { db } from "./db.js";
import { addDays } from "./dates.js";
import { fold, knownMerchant } from "./mail-merchants.js";
import { merchantKey as plainKey } from "./recurring.js";

const STOP = new Set([
  "com", "www", "net", "org", "es", "eu", "the", "and", "del", "las", "los", "con", "por", "para", "una", "uno",
  "sl", "sa", "slu", "sau", "inc", "ltd", "llc", "gmbh", "bv", "ab", "srl", "cia", "co", "spain", "espana", "iberia", "europe", "intl", "international",
  "compra", "pago", "pagos", "tarjeta", "tarj", "recibo", "cargo", "compras", "card", "payment", "purchase", "visa", "debito", "credito",
  "online", "web", "store", "shop", "tienda", "madrid", "barcelona", "valencia", "sevilla", "bilbao",
  "mktp", "marketplace", "pos", "bizum", "transferencia", "domiciliacion", "adeudo", "sepa",
]);

/** Significant lower-case tokens of a merchant or bank description. */
export function merchantTokens(text) {
  return fold(text)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t));
}

const compact = (text) => fold(text).replace(/[^a-z0-9]+/g, "");

/** Do two names plausibly denote the same merchant? */
export function merchantMatches(a, b) {
  if (!a || !b) return false;
  const ka = knownMerchant(a);
  const kb = knownMerchant(b);
  if (ka && kb) return ka.key === kb.key;
  const ta = merchantTokens(a);
  const tb = merchantTokens(b);
  if (!ta.length || !tb.length) return false;
  if (ta.some((t) => tb.includes(t))) return true;
  const ca = compact(a);
  const cb = compact(b);
  // "NETFLIXCOM" vs "Netflix": one significant token contained in the other string
  return ta.some((t) => t.length >= 4 && cb.includes(t)) || tb.some((t) => t.length >= 4 && ca.includes(t));
}

/** Stable key of a merchant: the known-merchant key, else the same folded form recurring.js uses. */
export const merchantKey = (name) => knownMerchant(name)?.key || plainKey(String(name ?? ""));

/**
 * Entry that is the same payment: same signed amount, date within `days`,
 * counterparty (or note) matching the merchant. Closest date wins; an entry
 * in the same account is preferred. Transfers never match.
 */
export function findMatchingEntry({ amount_cents, date, merchant, account_id = null, days = 3, exclude = [], mailOnly = false }) {
  const rows = db().prepare(
    `SELECT id, date, amount_cents, account_id, counterparty, note, source, source_ref, import_hash FROM entries
     WHERE amount_cents = ? AND date >= ? AND date <= ? AND transfer_id IS NULL${mailOnly ? " AND source = 'mail' AND import_hash IS NULL" : ""}
     ORDER BY date`,
  ).all(amount_cents, addDays(date, -days), addDays(date, days));
  const skip = new Set(exclude);
  const candidates = rows.filter((r) => !skip.has(r.id) && (merchantMatches(merchant, r.counterparty) || (r.source !== "mail" && merchantMatches(merchant, r.note))));
  if (!candidates.length) return null;
  const dist = (r) => Math.abs((Date.parse(r.date) - Date.parse(date)) / 86_400_000);
  candidates.sort((x, y) => (Number(y.account_id === account_id) - Number(x.account_id === account_id)) || dist(x) - dist(y));
  return candidates[0];
}
