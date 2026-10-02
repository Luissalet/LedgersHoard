// Shared by the server and the React client (imported relatively by both).
// Money is always stored as integer cents. The parsing and formatting rules are the family's
// (server/hoard-commons/money.js, vendored from Hoard Link); this file only keeps the names
// the app has always used: parseAmount() answers integer cents, formatCents() takes a symbol.
import { parseCents, detectDecimal, formatCents as formatCommon } from "../server/hoard-commons/money.js";

/**
 * Parse a human amount ("12,50", "1.234,56", "-3", "(12.00)", "12,5 €") into integer
 * cents, or null when the text is not a number. `options.decimal` forces the decimal
 * separator ("," or ".") when it is known, e.g. from a detected CSV column.
 */
export function parseAmount(input, options = {}) {
  return parseCents(input, { decimal: options.decimal || null });
}

/** The decimal separator used by a whole column of amount strings ("," | "." | null). */
export const detectColumnDecimal = detectDecimal;

/** Format cents as Spanish currency text: 123456 → "1.234,56 €"; `symbol` "" gives the bare number. */
export function formatCents(cents, symbol = "€") {
  const number = formatCommon(Number(cents) || 0, "EUR", "es").replace(/ €$/, "");
  return symbol ? `${number} ${symbol}` : number;
}
