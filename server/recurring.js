// Read-only candidates inferred from recorded expenses, never a subscription registry.
import { db } from "./db.js";
import { addMonths, isMonth, monthRange, thisMonth } from "./dates.js";
import { formatCents } from "./money.js";

const monthIndex = (date) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7));
const merchantKey = (name) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

export function recurringCandidates({ to = thisMonth(), months = 18 } = {}) {
  if (!isMonth(to) || !Number.isInteger(months) || months < 3 || months > 60)
    throw Object.assign(new Error("Usa to YYYY-MM y months entre 3 y 60."), { status: 400 });
  const from = addMonths(to, 1 - months);
  const rows = db().prepare(`SELECT e.id, e.date, e.amount_cents, e.counterparty,
      a.id AS account_id, a.name AS account_name, a.currency
    FROM entries e JOIN accounts a ON a.id = e.account_id
    WHERE e.date >= ? AND e.date <= ? AND e.amount_cents < 0
      AND e.transfer_id IS NULL AND trim(e.counterparty) <> ''
    ORDER BY e.date, e.id`).all(monthRange(from).from, monthRange(to).to);
  const groups = new Map();
  for (const row of rows) {
    const key = merchantKey(row.counterparty);
    if (!key) continue;
    const groupKey = `${row.account_id}\u0000${key}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(row);
  }
  const candidates = [];
  for (const entries of groups.values()) {
    if (entries.length < 3) continue;
    const gaps = entries.slice(1).map((entry, i) => monthIndex(entry.date) - monthIndex(entries[i].date));
    const monthly = gaps.every((gap) => gap === 1);
    const quarterly = gaps.every((gap) => gap === 3);
    if (!monthly && !quarterly) continue;
    const days = entries.map((entry) => Number(entry.date.slice(8)));
    if (Math.max(...days) - Math.min(...days) > 7) continue;
    const amounts = entries.map((entry) => -entry.amount_cents);
    const previous = median(amounts.slice(0, -1));
    const latest = amounts.at(-1);
    const change = latest - previous;
    const earlier = amounts.slice(0, -1);
    const variable = Math.max(...earlier) - Math.min(...earlier) > Math.max(100, Math.round(previous * 0.1));
    const price_change = !variable && Math.abs(change) > Math.max(100, Math.round(previous * 0.05));
    const last = entries.at(-1);
    candidates.push({
      counterparty: last.counterparty, account: last.account_name, currency: last.currency,
      frequency: monthly ? "monthly" : "quarterly", occurrences: entries.length,
      first_date: entries[0].date, last_date: last.date,
      typical_amount_cents: median(amounts), typical_amount: formatCents(median(amounts), last.currency === "EUR" ? "€" : last.currency),
      latest_amount_cents: latest, latest_amount: formatCents(latest, last.currency === "EUR" ? "€" : last.currency),
      previous_typical_amount_cents: previous, change_cents: change,
      change_percent: previous ? Math.round(change * 10000 / previous) / 100 : null,
      baseline_occurrences: earlier.length, baseline_first_date: entries[0].date,
      baseline_last_date: entries.at(-2).date,
      variable, price_change, evidence: entries.map((entry) => ({ id: entry.id, date: entry.date, amount_cents: -entry.amount_cents })),
    });
  }
  candidates.sort((a, b) => b.last_date.localeCompare(a.last_date) || a.counterparty.localeCompare(b.counterparty));
  return { from, to, candidates, note: "Candidatos inferidos de movimientos. price_change solo indica cambio del importe cobrado; no demuestra una suscripción activa, una subida de tarifa ni la causa de un recibo variable. Cita los movimientos, sin atribuir causas no registradas." };
}
