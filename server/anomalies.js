// Read-only spending anomalies per merchant: charges that break the pattern of their own
// counterparty (amount, a repeat within days, an extra charge in a month, a large first charge).
// Signals to review, never proof of fraud or an error; entries are never changed.
import { db } from "./db.js";
import { addMonths, isMonth, monthRange, thisMonth } from "./dates.js";
import { formatCents } from "./money.js";
import { merchantKey } from "./recurring.js";

const DAY = 86400000;
const toDay = (date) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / DAY;
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};
const money = (cents, currency) => formatCents(cents, currency === "EUR" ? "€" : currency);

export const ANOMALY_DEFAULTS = Object.freeze({
  spike_ratio: 1.8, // a charge at least this many times its merchant's median...
  spike_min_cents: 1000, // ...and at least 10 € above it
  duplicate_days: 3, // same merchant and amount again within this many days
  new_large_cents: 15000, // first charge of a merchant from this amount up...
  new_large_ratio: 4, // ...and this many times the median expense of the window
});

const bad = (message) => { throw Object.assign(new Error(message), { status: 400 }); };

/**
 * Charges in the last `recent_days` up to the end of `to` that break their merchant's
 * pattern over the last `months`. One finding per charge, by priority:
 * duplicate > amount_spike > extra_charge > new_merchant_large.
 */
export function spendingAnomalies({ to = thisMonth(), months = 12, recent_days = 45, account_id = null } = {}) {
  if (!isMonth(to) || !Number.isInteger(months) || months < 3 || months > 36)
    bad("Usa to YYYY-MM y months entre 3 y 36.");
  if (!Number.isInteger(recent_days) || recent_days < 1 || recent_days > 365) bad("recent_days va de 1 a 365.");
  const t = ANOMALY_DEFAULTS;
  const from = addMonths(to, 1 - months);
  const end = monthRange(to).to;
  const recentFrom = toDay(end) - (recent_days - 1);
  const rows = db().prepare(`SELECT e.id, e.date, e.amount_cents, e.counterparty, e.source,
      a.id AS account_id, a.name AS account_name, a.currency
    FROM entries e JOIN accounts a ON a.id = e.account_id
    WHERE e.date >= ? AND e.date <= ? AND e.amount_cents < 0
      AND e.transfer_id IS NULL AND trim(e.counterparty) <> ''
      AND (? IS NULL OR a.id = ?)
    ORDER BY e.date, e.created_at, e.id`).all(monthRange(from).from, end, account_id, account_id);
  const windowMedian = rows.length ? median(rows.map((row) => -row.amount_cents)) : 0;
  const groups = new Map();
  for (const row of rows) {
    const key = merchantKey(row.counterparty);
    if (!key) continue;
    const groupKey = `${row.account_id}\u0000${key}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(row);
  }
  const anomalies = [];
  for (const group of groups.values()) {
    group.forEach((entry, i) => {
      if (toDay(entry.date) < recentFrom) return;
      const amount = -entry.amount_cents;
      const earlier = group.slice(0, i);
      const amounts = earlier.map((row) => -row.amount_cents);
      const base = { entry_id: entry.id, date: entry.date, counterparty: entry.counterparty,
        account: entry.account_name, account_id: entry.account_id, currency: entry.currency,
        amount_cents: amount, amount: money(amount, entry.currency), history_occurrences: earlier.length };
      const twin = [...earlier].reverse().find((row) => -row.amount_cents === amount
        && toDay(entry.date) - toDay(row.date) <= t.duplicate_days);
      if (twin) {
        const days = toDay(entry.date) - toDay(twin.date);
        anomalies.push({ ...base, kind: "duplicate", severity: "high",
          reason: `Mismo importe (${base.amount}) en ${entry.counterparty} ${days === 0 ? "el mismo día" : `a ${days} día${days === 1 ? "" : "s"}`} del cobro del ${twin.date}.`,
          evidence: [twin, entry].map((row) => ({ id: row.id, date: row.date, amount_cents: -row.amount_cents })) });
        return;
      }
      if (amounts.length >= 3) {
        const typical = median(amounts);
        if (amount >= typical * t.spike_ratio && amount - typical >= t.spike_min_cents) {
          anomalies.push({ ...base, kind: "amount_spike", severity: amount >= typical * 3 ? "high" : "medium",
            typical_amount_cents: typical, typical_amount: money(typical, entry.currency),
            ratio: Math.round(amount * 100 / typical) / 100,
            reason: `${base.amount} frente a ${money(typical, entry.currency)} habituales (${earlier.length} cobros anteriores): ×${(Math.round(amount * 10 / typical) / 10).toLocaleString("es-ES")}.`,
            evidence: earlier.slice(-6).map((row) => ({ id: row.id, date: row.date, amount_cents: -row.amount_cents })) });
          return;
        }
      }
      const month = entry.date.slice(0, 7);
      const perMonth = new Map();
      for (const row of earlier) perMonth.set(row.date.slice(0, 7), (perMonth.get(row.date.slice(0, 7)) || 0) + 1);
      const sameMonth = perMonth.get(month) || 0;
      perMonth.delete(month);
      if (sameMonth >= 1 && perMonth.size >= 3 && [...perMonth.values()].every((count) => count === 1)) {
        anomalies.push({ ...base, kind: "extra_charge", severity: "medium",
          reason: `${entry.counterparty} cobra una vez al mes (${perMonth.size} meses) y este es el cobro nº ${sameMonth + 1} de ${month}.`,
          evidence: earlier.filter((row) => row.date.startsWith(month)).concat(entry)
            .map((row) => ({ id: row.id, date: row.date, amount_cents: -row.amount_cents })) });
        return;
      }
      if (!earlier.length && amount >= t.new_large_cents && amount >= windowMedian * t.new_large_ratio) {
        anomalies.push({ ...base, kind: "new_merchant_large", severity: "low",
          reason: `Primer cobro de ${entry.counterparty} en ${months} meses y de ${base.amount}, ×${Math.round(amount / Math.max(1, windowMedian))} el gasto mediano (${money(windowMedian, entry.currency)}).`,
          evidence: [{ id: entry.id, date: entry.date, amount_cents: amount }] });
      }
    });
  }
  const rank = { high: 0, medium: 1, low: 2 };
  anomalies.sort((a, b) => b.date.localeCompare(a.date) || rank[a.severity] - rank[b.severity] || a.counterparty.localeCompare(b.counterparty));
  return {
    from, to, recent_from: new Date(recentFrom * DAY).toISOString().slice(0, 10), months, recent_days,
    thresholds: { ...t }, anomalies,
    note: "Señales para revisar, no pruebas de fraude ni de error: un duplicado puede ser una compra repetida a propósito y una subida puede ser un recibo variable. Cita fecha, importe y lo habitual; no atribuyas causas.",
  };
}
