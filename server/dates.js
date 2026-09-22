// Date helpers. Dates are stored as "YYYY-MM-DD" strings, months as "YYYY-MM".

const pad = (n) => String(n).padStart(2, "0");

/** Today's date in the local time zone, "YYYY-MM-DD". */
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Current month, "YYYY-MM". */
export function thisMonth() {
  return today().slice(0, 7);
}

function valid(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Parse "YYYY-MM-DD", "DD/MM/YYYY", "DD-MM-YYYY", "DD.MM.YYYY", "YYYY/MM/DD"
 * and two-digit years ("05/03/24"). Returns "YYYY-MM-DD" or null.
 */
export function parseDate(input) {
  if (input instanceof Date) return valid(input.getFullYear(), input.getMonth() + 1, input.getDate());
  if (typeof input !== "string") return null;
  const text = input.trim();
  let m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[T\s].*)?$/);
  if (m) {
    let year = Number(m[3]);
    if (m[3].length === 2) year += year < 70 ? 2000 : 1900;
    return valid(year, Number(m[2]), Number(m[1]));
  }
  return null;
}

export function isMonth(text) {
  return typeof text === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(text);
}

/** First and last day of a "YYYY-MM" month. */
export function monthRange(month) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${pad(last)}` };
}

/** Add n months to "YYYY-MM". */
export function addMonths(month, n) {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/** Inclusive list of months between two "YYYY-MM" values. */
export function monthsBetween(from, to) {
  const out = [];
  let cursor = from;
  while (cursor <= to && out.length < 240) {
    out.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  return out;
}
