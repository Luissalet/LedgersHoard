// Shared by the server and the React client (imported relatively by both).
// Money is always stored as integer cents. This module converts user text
// ("12,50", "1.234,56", "-3", "(12.00)", "12,5 €") to cents and back.

const CURRENCY_NOISE = /[€$£]|eur|euros?|usd|gbp/gi;

/**
 * Parse a human amount into integer cents. Returns null when the text is not
 * a number. Accepts Spanish (1.234,56) and English (1,234.56) formats, a
 * leading/trailing minus, parentheses for negatives and currency symbols.
 * `options.decimal` forces the decimal separator ("," or ".") when known,
 * e.g. from a CSV column where the format has been detected.
 */
export function parseAmount(input, options = {}) {
  if (typeof input === "number") {
    return Number.isFinite(input) ? Math.round(input * 100) : null;
  }
  if (typeof input !== "string") return null;
  let text = input.replace(CURRENCY_NOISE, "").replace(/[\s  ']/g, "");
  if (!text) return null;

  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.startsWith("+")) text = text.slice(1);
  if (text.startsWith("-") || text.startsWith("−")) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.endsWith("-")) {
    negative = !negative;
    text = text.slice(0, -1);
  }
  if (!/^[0-9.,]+$/.test(text) || !/[0-9]/.test(text)) return null;

  const decimal = options.decimal || detectDecimal(text);
  const thousands = decimal === "," ? "." : ",";
  if (text.split(decimal).length > 2) return null;
  const [intRaw, fracRaw = ""] = text.split(decimal);
  const groups = intRaw.split(thousands);
  // Thousands groups after the first must be exactly three digits ("1.234.567").
  if (groups.length > 1 && (groups.slice(1).some((g) => g.length !== 3) || groups[0].length > 3)) return null;
  const intPart = groups.join("");
  if (fracRaw.includes(thousands)) return null;
  if (!/^[0-9]*$/.test(intPart) || !/^[0-9]*$/.test(fracRaw)) return null;
  if (intPart === "" && fracRaw === "") return null;

  const whole = Number(intPart || "0");
  let cents = whole * 100;
  if (fracRaw) {
    const padded = (fracRaw + "000").slice(0, 3);
    cents += Number(padded.slice(0, 2)) + (Number(padded[2]) >= 5 ? 1 : 0);
  }
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

/** Decide whether "," or "." is the decimal separator for a cleaned number. */
function detectDecimal(text) {
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) return lastComma > lastDot ? "," : ".";
  const sep = lastComma >= 0 ? "," : lastDot >= 0 ? "." : null;
  if (!sep) return ",";
  const parts = text.split(sep);
  // Repeated separators can only be thousands groups: "1.234.567".
  if (parts.length > 2) return sep === "," ? "." : ",";
  // A single separator followed by exactly 3 digits after 1-3 leading digits
  // is read as a thousands group ("1.234", "12,500"); anything else is decimal.
  const [head, tail] = parts;
  if (tail.length === 3 && head.length >= 1 && head.length <= 3 && head !== "0") {
    return sep === "," ? "." : ",";
  }
  return sep;
}

/** Detect the decimal separator used by a whole column of amount strings. */
export function detectColumnDecimal(values) {
  let commaDecimal = 0;
  let dotDecimal = 0;
  for (const raw of values) {
    const v = String(raw ?? "").replace(CURRENCY_NOISE, "").replace(/[\s ]/g, "");
    if (/,\d{1,2}$/.test(v)) commaDecimal++;
    if (/\.\d{1,2}$/.test(v)) dotDecimal++;
    if (/\.\d{3},\d+$/.test(v)) commaDecimal++;
    if (/,\d{3}\.\d+$/.test(v)) dotDecimal++;
  }
  if (commaDecimal === 0 && dotDecimal === 0) return null;
  return commaDecimal >= dotDecimal ? "," : ".";
}

/** Format cents as Spanish currency text: 123456 → "1.234,56 €". */
export function formatCents(cents, symbol = "€") {
  const value = Number(cents) || 0;
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${grouped},${frac}${symbol ? ` ${symbol}` : ""}`;
}
