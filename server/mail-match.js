// Matching a merchant name against an entry's counterparty, and finding an
// existing entry that is the same payment (used to avoid double counting
// between mail, manual entries and bank CSV imports). Who a merchant is, whether
// two names are the same shop and the key a merchant is grouped by come from the
// family's merchant table (hoard-commons/merchants.js).
import { db } from "./db.js";
import { addDays } from "./dates.js";
import { DATA, merchantSimilar, merchantKey as familyKey } from "./hoard-commons/merchants.js";

/** Categories whose merchants are never a subscription by themselves: only explicit membership wording makes one. */
export const SHOP_CATS = new Set(DATA.shop_categories);

/** Do two names plausibly denote the same merchant? */
export const merchantMatches = merchantSimilar;

/** Stable key of a merchant: the known merchant's id, else the folded name without its legal suffix. */
export const merchantKey = (name) => familyKey(String(name ?? ""));

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
