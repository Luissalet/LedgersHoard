// Subscriptions: detected from mail (charges, renewal notices) or from
// recorded entries, kept with their price history. Alerts are created once
// per dedupe key through notifications.js.
import { z } from "zod";
import { db, uid, now } from "./db.js";
import { addDays, addMonthsToDate, daysBetween, today as todayLocal } from "./dates.js";
import { formatCents } from "./money.js";
import { getAccount } from "./accounts.js";
import { getCategory } from "./categories.js";
import { merchantKey, merchantMatches } from "./mail-match.js";
import { knownMerchant, SHOP_CATS } from "./mail-merchants.js";
import { recurringCandidates } from "./recurring.js";
import { notify } from "./notifications.js";

export const PERIODS = ["monthly", "yearly", "weekly", "unknown"];
export const STATUSES = ["active", "trial", "cancelled", "paused"];
const MAX_HISTORY = 24;

const money = (cents, currency = "EUR") => formatCents(cents, currency === "EUR" ? "€" : currency);
const periodText = { monthly: "al mes", yearly: "al año", weekly: "a la semana", unknown: "" };
const row = (r) => (r ? { ...r, price_history: JSON.parse(r.price_history || "[]") } : null);
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

export function getSubscription(id) {
  return row(db().prepare("SELECT * FROM subscriptions WHERE id = ?").get(id));
}
export function findSubscriptionByKey(key) {
  return row(db().prepare("SELECT * FROM subscriptions WHERE merchant_key = ?").get(key));
}

export function listSubscriptions({ status = null } = {}) {
  const rows = status
    ? db().prepare("SELECT * FROM subscriptions WHERE status = ? ORDER BY merchant COLLATE NOCASE").all(status)
    : db().prepare("SELECT * FROM subscriptions ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'trial' THEN 1 WHEN 'paused' THEN 2 ELSE 3 END, merchant COLLATE NOCASE").all();
  return rows.map(row);
}

/** Monthly cost of one subscription in cents (yearly / 12, weekly * 52 / 12); null when the period is unknown. */
export function monthlyCents(sub) {
  if (sub.period === "monthly") return sub.amount_cents;
  if (sub.period === "yearly") return Math.round(sub.amount_cents / 12);
  if (sub.period === "weekly") return Math.round((sub.amount_cents * 52) / 12);
  return null;
}
/** Yearly cost: monthly * 12, weekly * 52, yearly as is. */
export function yearlyCents(sub) {
  if (sub.period === "monthly") return sub.amount_cents * 12;
  if (sub.period === "yearly") return sub.amount_cents;
  if (sub.period === "weekly") return sub.amount_cents * 52;
  return null;
}

/** Totals of active subscriptions per currency. */
export function totals() {
  const byCurrency = new Map();
  let unknown = 0;
  for (const sub of listSubscriptions({ status: "active" })) {
    const m = monthlyCents(sub);
    if (m === null) { unknown++; continue; }
    const t = byCurrency.get(sub.currency) || { currency: sub.currency, monthly_cents: 0, yearly_cents: 0, count: 0 };
    t.monthly_cents += m;
    t.yearly_cents += yearlyCents(sub);
    t.count++;
    byCurrency.set(sub.currency, t);
  }
  const list = [...byCurrency.values()].map((t) => ({ ...t, monthly_text: money(t.monthly_cents, t.currency), yearly_text: money(t.yearly_cents, t.currency) }));
  return { totals: list, unknown_period: unknown };
}

/** Charges and trial ends in the next `days` days. */
export function upcoming({ days = 30, from = todayLocal() } = {}) {
  const to = addDays(from, days);
  const items = [];
  for (const sub of listSubscriptions()) {
    if (sub.status === "cancelled" || sub.status === "paused") continue;
    if (sub.next_charge_date && sub.next_charge_date >= from && sub.next_charge_date <= to) {
      items.push({ id: sub.id, merchant: sub.merchant, kind: "charge", date: sub.next_charge_date, amount_cents: sub.amount_cents, currency: sub.currency, amount_text: money(sub.amount_cents, sub.currency), period: sub.period, status: sub.status });
    }
    if (sub.trial_end_date && sub.trial_end_date >= from && sub.trial_end_date <= to && sub.trial_end_date !== sub.next_charge_date) {
      items.push({ id: sub.id, merchant: sub.merchant, kind: "trial_end", date: sub.trial_end_date, amount_cents: sub.amount_cents, currency: sub.currency, amount_text: money(sub.amount_cents, sub.currency), period: sub.period, status: sub.status });
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.merchant.localeCompare(b.merchant));
}

export function nextChargeDate(lastDate, period) {
  if (!lastDate) return null;
  if (period === "monthly") return addMonthsToDate(lastDate, 1);
  if (period === "yearly") return addMonthsToDate(lastDate, 12);
  if (period === "weekly") return addDays(lastDate, 7);
  return null;
}

const patchSchema = z.object({
  merchant: z.string().trim().min(1).max(80),
  status: z.enum(STATUSES),
  amount_cents: z.number().int().min(0),
  currency: z.string().trim().length(3).transform((v) => v.toUpperCase()),
  period: z.enum(PERIODS),
  category_id: z.string().nullable(),
  account_id: z.string().nullable(),
  next_charge_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  trial_end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  notes: z.string().trim().max(2000),
}).partial().strict();

export function updateSubscription(id, patch) {
  const current = getSubscription(id);
  if (!current) return null;
  const data = patchSchema.parse(patch || {});
  if (data.category_id && !getCategory(data.category_id)) fail("La categoría no existe.");
  if (data.account_id && !getAccount(data.account_id)) fail("La cuenta no existe.");
  const next = { ...current, ...data };
  if (data.status === "cancelled") next.next_charge_date = data.next_charge_date ?? null;
  db().prepare(
    `UPDATE subscriptions SET merchant = ?, status = ?, amount_cents = ?, currency = ?, period = ?, category_id = ?, account_id = ?,
       next_charge_date = ?, trial_end_date = ?, notes = ?, updated_at = ? WHERE id = ?`,
  ).run(next.merchant, next.status, next.amount_cents, next.currency, next.period, next.category_id, next.account_id,
    next.next_charge_date, next.trial_end_date, next.notes, now(), id);
  return getSubscription(id);
}

const createSchema = z.object({
  merchant: z.string().trim().min(1).max(80),
  amount_cents: z.number().int().min(0),
  currency: z.string().trim().length(3).default("EUR").transform((v) => v.toUpperCase()),
  period: z.enum(PERIODS).default("monthly"),
  status: z.enum(STATUSES).default("active"),
  next_charge_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  category_id: z.string().nullable().default(null),
  account_id: z.string().nullable().default(null),
  notes: z.string().trim().max(2000).default(""),
});

export function createSubscription(input, { source = "manual", key: keyOverride = null } = {}) {
  const data = createSchema.parse(input || {});
  const key = keyOverride || merchantKey(data.merchant);
  if (findSubscriptionByKey(key)) fail("Ya existe una suscripción de ese comercio.", 409);
  const id = uid();
  const ts = now();
  db().prepare(
    `INSERT INTO subscriptions (id, merchant, merchant_key, amount_cents, currency, period, status, last_charge_date, next_charge_date, trial_end_date,
       account_id, category_id, price_history, source, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, '[]', ?, ?, ?, ?)`,
  ).run(id, data.merchant, key, data.amount_cents, data.currency, data.period, data.status, data.next_charge_date, data.account_id, data.category_id, source, data.notes, ts, ts);
  return getSubscription(id);
}

export function deleteSubscription(id) {
  return db().prepare("DELETE FROM subscriptions WHERE id = ?").run(id).changes > 0;
}

// ---------------------------------------------------------------- recurring evidence
const GAP = { monthly: [25, 35], yearly: [350, 380], weekly: [6, 8] };

/**
 * Period shown by the recorded charges of one merchant: at least two charges
 * of a similar amount (±10 %) spaced about a month, a year or a week apart.
 * `date`/`amount` is the charge being observed (it may not be an entry yet).
 */
export function detectPeriodFromEntries({ merchant, amount_cents, date }) {
  const rows = db().prepare(
    "SELECT date, amount_cents, counterparty FROM entries WHERE amount_cents < 0 AND transfer_id IS NULL AND counterparty <> '' ORDER BY date",
  ).all().filter((r) => merchantMatches(merchant, r.counterparty) && Math.abs(Math.abs(r.amount_cents) - amount_cents) <= amount_cents * 0.1);
  const dates = [...new Set([...rows.map((r) => r.date), date])].sort();
  const distinct = dates.filter((d, i) => i === 0 || daysBetween(dates[i - 1], d) > 3);
  if (distinct.length < 2) return null;
  const gaps = distinct.slice(1).map((d, i) => daysBetween(distinct[i], d));
  for (const [period, [lo, hi]] of Object.entries(GAP)) if (gaps.every((g) => g >= lo && g <= hi)) return period;
  return null;
}

// ---------------------------------------------------------------- observations
const priceKind = (oldCents, newCents) => (newCents > oldCents ? "sube" : "baja");

async function priceAlert(sub, oldCents, oldCurrency, newCents, newCurrency) {
  const title = oldCurrency !== newCurrency
    ? `${sub.merchant} cambia de divisa: ${money(oldCents, oldCurrency)} → ${money(newCents, newCurrency)}`
    : `${sub.merchant} ${priceKind(oldCents, newCents)} de ${money(oldCents, oldCurrency)} a ${money(newCents, newCurrency)}`;
  return notify({
    kind: "subscription.price", severity: "medium", title, body: `${sub.merchant}: ${periodText[sub.period] || ""}`.trim(),
    dedupe_key: `price:${sub.merchant_key}:${newCents}:${newCurrency}`, event: "ledger.subscription.price",
    payload: { subscription_id: sub.id, merchant: sub.merchant, from_cents: oldCents, to_cents: newCents, from_currency: oldCurrency, to_currency: newCurrency },
  });
}

const changed = (oldCents, newCents) => oldCents > 0 && Math.abs(newCents - oldCents) / oldCents >= 0.01;

async function newAlert(sub) {
  const amount = sub.amount_cents ? `${money(sub.amount_cents, sub.currency)} ${periodText[sub.period] || ""}`.trim() : "importe sin confirmar";
  return notify({
    kind: "subscription.new", severity: "medium", title: `Nueva suscripción detectada: ${sub.merchant}`, body: amount,
    dedupe_key: `new:${sub.merchant_key}`, event: "ledger.subscription.new",
    payload: { subscription_id: sub.id, merchant: sub.merchant, amount_cents: sub.amount_cents, currency: sub.currency, period: sub.period },
  });
}

/**
 * A charge was seen (recorded from mail, or a duplicate of an existing entry).
 * Creates the subscription when the evidence says so, keeps the price
 * history and raises the price alert once. Returns the subscription or null.
 */
export async function observeCharge({ merchant, amount_cents, currency = "EUR", date, period = "unknown", next_date = null, hint = false, account_id = null, category_id = null, key: keyOverride = null, name = null, recurring = true }) {
  const key = keyOverride || merchantKey(merchant);
  const label = name || merchant;
  let sub = findSubscriptionByKey(key);
  let detected = period;
  if (!sub) {
    // shops and food are never recurring by pattern alone: they need explicit membership wording (hint)
    const fromEntries = recurring ? detectPeriodFromEntries({ merchant, amount_cents, date }) : null;
    if (!hint && !fromEntries) return null;
    if (detected === "unknown" && fromEntries) detected = fromEntries;
    sub = createSubscription({
      merchant: label, amount_cents, currency, period: detected, status: "active", account_id, category_id,
      next_charge_date: next_date || nextChargeDate(date, detected),
    }, { source: "mail", key });
    db().prepare("UPDATE subscriptions SET last_charge_date = ?, price_history = ? WHERE id = ?")
      .run(date, JSON.stringify([{ date, amount_cents, currency }]), sub.id);
    sub = getSubscription(sub.id);
    await newAlert(sub);
    return sub;
  }
  const seen = sub.price_history.some((h) => h.amount_cents === amount_cents && h.currency === currency && Math.abs(daysBetween(h.date, date)) <= 3);
  if (seen) return sub;
  const newer = !sub.last_charge_date || date > sub.last_charge_date;
  const history = [...sub.price_history, { date, amount_cents, currency }].sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_HISTORY);
  if (!newer) {
    db().prepare("UPDATE subscriptions SET price_history = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(history), now(), sub.id);
    return getSubscription(sub.id);
  }
  const oldCents = sub.amount_cents;
  const oldCurrency = sub.currency;
  const newPeriod = sub.period === "unknown" ? (detected !== "unknown" ? detected : (recurring && detectPeriodFromEntries({ merchant, amount_cents, date })) || "unknown") : sub.period;
  const next = next_date || nextChargeDate(date, newPeriod) || sub.next_charge_date;
  db().prepare(
    `UPDATE subscriptions SET amount_cents = ?, currency = ?, period = ?, status = 'active', last_charge_date = ?, next_charge_date = ?, trial_end_date = NULL,
       price_history = ?, account_id = COALESCE(account_id, ?), category_id = COALESCE(category_id, ?), updated_at = ? WHERE id = ?`,
  ).run(amount_cents, currency, newPeriod, date, next, JSON.stringify(history), account_id, category_id, now(), sub.id);
  sub = getSubscription(sub.id);
  if (oldCurrency !== currency || changed(oldCents, amount_cents)) await priceAlert(sub, oldCents, oldCurrency, amount_cents, currency);
  return sub;
}

/** Renewal or trial notice, or a price-change notice: no entry, it feeds the subscription. */
export async function observeUpcoming({ merchant, amount_cents = null, currency = "EUR", period = "unknown", next_date = null, trial_end = null, price_change = null, today = todayLocal() }) {
  if (!merchant) return null;
  const key = merchantKey(merchant);
  let sub = findSubscriptionByKey(key);
  if (!sub) {
    if (!amount_cents && !next_date && !trial_end) return null;
    sub = createSubscription({
      merchant, amount_cents: amount_cents || 0, currency, period, status: trial_end ? "trial" : "active", next_charge_date: next_date || trial_end || null,
    }, { source: "mail" });
    if (trial_end) db().prepare("UPDATE subscriptions SET trial_end_date = ? WHERE id = ?").run(trial_end, sub.id);
    sub = getSubscription(sub.id);
    await newAlert(sub);
    return sub;
  }
  const oldCents = sub.amount_cents;
  const oldCurrency = sub.currency;
  const newCents = amount_cents ?? sub.amount_cents;
  const patch = {
    amount_cents: newCents || sub.amount_cents,
    currency: amount_cents ? currency : sub.currency,
    period: sub.period === "unknown" ? period : sub.period,
    next_charge_date: next_date || sub.next_charge_date,
    trial_end_date: trial_end || sub.trial_end_date,
  };
  const status = trial_end && !sub.last_charge_date && sub.status !== "cancelled" ? "trial" : sub.status;
  db().prepare("UPDATE subscriptions SET amount_cents = ?, currency = ?, period = ?, next_charge_date = ?, trial_end_date = ?, status = ?, updated_at = ? WHERE id = ?")
    .run(patch.amount_cents, patch.currency, patch.period, patch.next_charge_date, patch.trial_end_date, status, now(), sub.id);
  sub = getSubscription(sub.id);
  if (amount_cents && (patch.currency !== oldCurrency || changed(oldCents, newCents))) {
    const was = oldCents || price_change?.from_cents || 0;
    if (was) await priceAlert(sub, was, oldCurrency, newCents, patch.currency);
  }
  return sub;
}

export async function observeCancel({ merchant, message_id, date }) {
  if (!merchant) return null;
  const key = merchantKey(merchant);
  const sub = findSubscriptionByKey(key);
  if (sub) db().prepare("UPDATE subscriptions SET status = 'cancelled', next_charge_date = NULL, trial_end_date = NULL, updated_at = ? WHERE id = ?").run(now(), sub.id);
  await notify({
    kind: "subscription.cancelled", severity: "low", title: `Cancelación confirmada: ${merchant}`, body: "La suscripción figura como cancelada.",
    dedupe_key: `cancel:${key}:${date || message_id}`, event: "ledger.subscription.cancelled",
    payload: { subscription_id: sub?.id || null, merchant },
  });
  return sub ? getSubscription(sub.id) : null;
}

export async function observeFailed({ merchant, amount_cents, currency = "EUR", message_id }) {
  const name = merchant || "un comercio";
  return notify({
    kind: "payment.failed", severity: "high", title: `Pago rechazado: ${name}`,
    body: amount_cents ? `${money(amount_cents, currency)}. Revisa el método de pago.` : "Revisa el método de pago.",
    dedupe_key: `failed:${message_id}`, event: "ledger.payment.failed",
    payload: { merchant: merchant || null, amount_cents: amount_cents ?? null, currency, message_id },
  });
}

/** Time-based alerts: trial ending in <= 3 days, yearly charge in <= 7 days. */
export async function sweepAlerts(today = todayLocal()) {
  let created = 0;
  for (const sub of listSubscriptions()) {
    if (sub.status === "cancelled" || sub.status === "paused") continue;
    if (sub.trial_end_date) {
      const left = daysBetween(today, sub.trial_end_date);
      if (left >= 0 && left <= 3) {
        const text = left === 0 ? "termina hoy" : left === 1 ? "termina mañana" : `termina en ${left} días`;
        const a = await notify({
          kind: "subscription.trial", severity: "high", title: `La prueba de ${sub.merchant} ${text}`,
          body: sub.amount_cents ? `Después se cobrará ${money(sub.amount_cents, sub.currency)} ${periodText[sub.period] || ""}`.trim() : "Cancela antes si no quieres seguir.",
          dedupe_key: `trial:${sub.id}:${sub.trial_end_date}`, event: "ledger.subscription.trial",
          payload: { subscription_id: sub.id, merchant: sub.merchant, trial_end_date: sub.trial_end_date, days_left: left },
        });
        if (a) created++;
      }
    }
    if (sub.period === "yearly" && sub.next_charge_date) {
      const left = daysBetween(today, sub.next_charge_date);
      if (left >= 0 && left <= 7) {
        const a = await notify({
          kind: "subscription.upcoming", severity: "medium", title: `${sub.merchant} se renueva ${left === 0 ? "hoy" : `en ${left} días`}`,
          body: `${money(sub.amount_cents, sub.currency)} al año, el ${sub.next_charge_date}.`,
          dedupe_key: `upcoming:${sub.id}:${sub.next_charge_date}`, event: "ledger.subscription.upcoming",
          payload: { subscription_id: sub.id, merchant: sub.merchant, date: sub.next_charge_date, amount_cents: sub.amount_cents, currency: sub.currency },
        });
        if (a) created++;
      }
    }
  }
  return created;
}

/** Subscriptions from recorded entries (monthly candidates with a steady amount), source "recurring". */
export function syncFromEntries({ to, months = 18 } = {}) {
  const found = recurringCandidates({ ...(to ? { to } : {}), months });
  const created = [];
  for (const c of found.candidates) {
    if (c.variable || c.frequency !== "monthly") continue;
    const known = knownMerchant(c.counterparty);
    if (known && (known.sub === false && SHOP_CATS.has(known.cat))) continue;
    const key = merchantKey(c.counterparty);
    if (findSubscriptionByKey(key)) continue;
    const sub = createSubscription({
      merchant: c.counterparty, amount_cents: c.latest_amount_cents, currency: c.currency, period: "monthly",
      next_charge_date: nextChargeDate(c.last_date, "monthly"),
    }, { source: "recurring" });
    db().prepare("UPDATE subscriptions SET last_charge_date = ?, price_history = ? WHERE id = ?")
      .run(c.last_date, JSON.stringify(c.evidence.slice(-MAX_HISTORY).map((e) => ({ date: e.date, amount_cents: e.amount_cents, currency: c.currency }))), sub.id);
    created.push(getSubscription(sub.id));
  }
  return created;
}

/** Everything the Suscripciones page shows. */
export function summary({ days = 30 } = {}) {
  return { subscriptions: listSubscriptions().map(present), ...totals(), upcoming: upcoming({ days }) };
}

export function present(sub) {
  return {
    ...sub, amount_text: money(sub.amount_cents, sub.currency),
    monthly_cents: monthlyCents(sub), yearly_cents: yearlyCents(sub),
  };
}
