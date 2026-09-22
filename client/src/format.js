// Formatting helpers for the UI (Spanish conventions). The amount parser and
// formatter are the server's own, so text like "1.234,56" means the same everywhere.
import { parseAmount, formatCents } from "../../shared/money.js";

export { parseAmount, formatCents };

/** Cents to editable text without symbol: 1250 → "12,50". */
export function centsToText(cents) {
  return formatCents(cents, "");
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function monthLabel(month) {
  if (!month) return "";
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function monthShort(month) {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}`;
}

export function dateLabel(date) {
  if (!date) return "";
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function thisMonth() {
  return today().slice(0, 7);
}

/** Last day of a "YYYY-MM" month as "YYYY-MM-DD". */
export function monthEnd(month) {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

export function addMonths(month, n) {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

export const ACCOUNT_TYPES = { cash: "Efectivo", bank: "Banco", card: "Tarjeta", savings: "Ahorro", other: "Otra" };
export const KINDS = { expense: "Gasto", income: "Ingreso" };
