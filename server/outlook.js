// forecast_month: where the balance will stand at the end of a month. It starts from the balance today (or from the
// projection of the month before), adds what is expected to arrive and leave (subscriptions, charges that repeat every
// month, income that repeats every month) and an allowance for the rest of the spending, the average of the last three
// full months. Every line says where it comes from; nothing is written.
import { db } from "./db.js";
import { accountBalances } from "./accounts.js";
import { addDays, addMonths, addMonthsToDate, daysBetween, isMonth, monthRange, today as todayLocal } from "./dates.js";
import { formatCents } from "./money.js";
import { listSubscriptions, monthlyCents } from "./subscriptions.js";
import { recurringCandidates, merchantKey } from "./recurring.js";
import { merchantMatches } from "./mail-match.js";

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const MAX_AHEAD = 12;
const monthIndex = (m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7));
const dec = (cents) => Math.round(cents) / 100;

/** The currency of the active accounts (the most common one; EUR on a tie). */
function mainCurrency(accounts) {
  const counts = new Map();
  for (const a of accounts) counts.set(a.currency, (counts.get(a.currency) || 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] === "EUR" ? -1 : 1))[0];
  return best ? best[0] : "EUR";
}

/** Dates of a repeating charge that fall in [from, to], stepping from its next known date. */
function occurrences(first, period, from, to) {
  if (!first) return [];
  const step = (d) => (period === "yearly" ? addMonthsToDate(d, 12) : period === "weekly" ? addDays(d, 7) : period === "quarterly" ? addMonthsToDate(d, 3) : addMonthsToDate(d, 1));
  const out = [];
  let d = first;
  for (let i = 0; i < 400 && d <= to; i++) {
    if (d >= from) out.push(d);
    d = step(d);
  }
  return out;
}

function subscriptionLines(currency, from, to) {
  const lines = [];
  for (const sub of listSubscriptions()) {
    if (sub.status === "cancelled" || sub.status === "paused" || sub.currency !== currency || !sub.amount_cents) continue;
    const period = sub.period === "unknown" ? "" : sub.period;
    let first = sub.next_charge_date || null;
    if (sub.status === "trial" && sub.trial_end_date) first = sub.trial_end_date;
    if (!first) continue;
    if (!period) { if (first >= from && first <= to) lines.push({ kind: "subscription", label: sub.merchant, date: first, amount_cents: -sub.amount_cents, source: sub.id }); continue; }
    // a next date that is already behind the window repeats forward from it
    for (const date of occurrences(first, period, from, to)) lines.push({ kind: "subscription", label: sub.merchant, date, amount_cents: -sub.amount_cents, source: sub.id });
  }
  return lines;
}

function recurringLines(currency, from, to, subscriptions, today) {
  const lines = [];
  const month = to.slice(0, 7);
  for (const c of recurringCandidates({ to: today.slice(0, 7), months: 12 }).candidates) {
    if (c.variable || c.currency !== currency) continue;
    if (subscriptions.some((s) => merchantMatches(c.counterparty, s.merchant) || merchantKey(c.counterparty) === s.merchant_key)) continue;
    const next = addMonthsToDate(c.last_date, c.frequency === "quarterly" ? 3 : 1);
    for (const date of occurrences(next, c.frequency, from, to)) {
      if (date.slice(0, 7) > month) continue;
      lines.push({ kind: "recurring", label: c.counterparty, date, amount_cents: -c.latest_amount_cents, source: `recurring:${merchantKey(c.counterparty)}` });
    }
  }
  return lines;
}

/** Income that arrived in each of the last three months from the same payer, about the same amount and day. */
function incomeLines(currency, from, to, today) {
  const month = to.slice(0, 7); // the window sits in one month; the pattern is read from the three months before today's
  const last3 = [addMonths(today.slice(0, 7), -3), addMonths(today.slice(0, 7), -2), addMonths(today.slice(0, 7), -1)];
  const rows = db().prepare(
    `SELECT e.date, e.amount_cents, e.counterparty FROM entries e JOIN accounts a ON a.id = e.account_id
     WHERE e.amount_cents > 0 AND e.transfer_id IS NULL AND trim(e.counterparty) <> '' AND a.currency = ? AND e.date >= ? AND e.date <= ? ORDER BY e.date`,
  ).all(currency, monthRange(last3[0]).from, monthRange(last3[2]).to);
  const groups = new Map();
  for (const r of rows) {
    const key = merchantKey(r.counterparty);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const lines = [];
  for (const [key, list] of groups) {
    const perMonth = last3.map((m) => list.filter((r) => r.date.startsWith(m)));
    if (perMonth.some((l) => l.length !== 1)) continue;
    const amounts = perMonth.map((l) => l[0].amount_cents);
    const days = perMonth.map((l) => Number(l[0].date.slice(8)));
    const typical = [...amounts].sort((a, b) => a - b)[1];
    if (Math.max(...amounts) - Math.min(...amounts) > Math.max(100, typical * 0.1) || Math.max(...days) - Math.min(...days) > 5) continue;
    const day = Math.round(days.reduce((a, b) => a + b, 0) / days.length);
    const date = `${month}-${String(Math.min(day, Number(monthRange(month).to.slice(8)))).padStart(2, "0")}`;
    const received = db().prepare("SELECT counterparty FROM entries WHERE amount_cents > 0 AND transfer_id IS NULL AND date >= ? AND date <= ?").all(monthRange(month).from, monthRange(month).to)
      .some((r) => merchantKey(r.counterparty) === key);
    if (date > today && date >= from && date <= to && !received) lines.push({ kind: "income", label: list.at(-1).counterparty, date, amount_cents: typical, source: `income:${key}` });
  }
  return lines;
}

/** Average monthly spending of the last three full months in a currency (transfers out), cents. */
function averageSpend(currency, today) {
  const first = addMonths(today.slice(0, 7), -3);
  const last = addMonths(today.slice(0, 7), -1);
  const row = db().prepare(
    `SELECT COALESCE(SUM(-e.amount_cents), 0) AS spent FROM entries e JOIN accounts a ON a.id = e.account_id
     WHERE e.amount_cents < 0 AND e.transfer_id IS NULL AND a.currency = ? AND e.date >= ? AND e.date <= ?`,
  ).get(currency, monthRange(first).from, monthRange(last).to);
  return Math.round(row.spent / 3);
}

function project(month, today) {
  const accounts = accountBalances(null).filter((a) => !a.archived);
  const currency = mainCurrency(accounts);
  const range = monthRange(month);
  const current = today.slice(0, 7);
  const others = [...new Set(accounts.map((a) => a.currency).filter((c) => c !== currency))];
  if (month < current) {
    const at = accountBalances(range.to).filter((a) => !a.archived && a.currency === currency);
    const end = at.reduce((s, a) => s + a.balance, 0);
    return { currency, today_cents: end, expected_in: 0, expected_out: 0, end_cents: end, lines: [], others, past: true, accounts: at };
  }
  let startBalance;
  let from;
  let baseAccounts;
  if (month === current) {
    baseAccounts = accountBalances(today).filter((a) => !a.archived && a.currency === currency);
    startBalance = baseAccounts.reduce((s, a) => s + a.balance, 0);
    from = addDays(today, 1);
  } else {
    const before = project(addMonths(month, -1), today);
    baseAccounts = before.accounts;
    startBalance = before.end_cents;
    from = range.from;
  }
  const to = range.to;
  const subscriptions = listSubscriptions();
  const lines = [
    ...subscriptionLines(currency, from, to),
    ...recurringLines(currency, from, to, subscriptions, today),
    ...incomeLines(currency, from, to, today),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
  // the rest of the spending: the three-month average, less what the lines above already stand for, over the days left
  const daysInMonth = Number(range.to.slice(8));
  const daysLeft = month === current ? Math.max(0, daysBetween(today, to)) : daysInMonth;
  const fixedMonthly = subscriptions.filter((s) => s.status === "active" && s.currency === currency).reduce((s, x) => s + (monthlyCents(x) || 0), 0);
  const variableMonthly = Math.max(0, averageSpend(currency, today) - fixedMonthly);
  const variable = Math.round((variableMonthly * daysLeft) / daysInMonth);
  if (variable > 0) lines.push({ kind: "variable", label: "Resto de gastos (media de los 3 últimos meses)", date: to, amount_cents: -variable, source: "average" });
  const expectedIn = lines.filter((l) => l.amount_cents > 0).reduce((s, l) => s + l.amount_cents, 0);
  const expectedOut = lines.filter((l) => l.amount_cents < 0).reduce((s, l) => s - l.amount_cents, 0);
  return { currency, today_cents: startBalance, expected_in: expectedIn, expected_out: expectedOut, end_cents: startBalance + expectedIn - expectedOut, lines, others, past: false, accounts: baseAccounts };
}

export function forecastMonth({ month, today = todayLocal() } = {}) {
  const m = month || today.slice(0, 7);
  if (!isMonth(m)) fail("Mes no válido (YYYY-MM).");
  if (monthIndex(m) - monthIndex(today.slice(0, 7)) > MAX_AHEAD) fail(`Solo se proyecta hasta ${MAX_AHEAD} meses por delante.`);
  const p = project(m, today);
  const sym = p.currency === "EUR" ? "€" : p.currency;
  const fmt = (c) => formatCents(c, sym);
  return {
    ok: true, month: m, currency: p.currency,
    today_balance: dec(p.today_cents), expected_in: dec(p.expected_in), expected_out: dec(p.expected_out), projected_end: dec(p.end_cents),
    today_balance_cents: p.today_cents, expected_in_cents: p.expected_in, expected_out_cents: p.expected_out, projected_end_cents: p.end_cents,
    projected_end_text: fmt(p.end_cents),
    lines: p.lines.map((l) => ({ ...l, amount: dec(l.amount_cents), amount_text: fmt(l.amount_cents) })),
    accounts: p.accounts.map((a) => ({ account_id: a.id, name: a.name, balance_cents: a.balance })),
    ...(p.others.length ? { other_currencies: p.others, note_currencies: `Las cuentas en ${p.others.join(", ")} no se suman.` } : {}),
    note: p.past
      ? "Mes pasado: el saldo es el real al cierre del mes."
      : "Proyección: saldo de hoy más los cobros y pagos que se repiten (suscripciones, recibos y nóminas de los últimos meses) y la media de gasto de los 3 últimos meses para el resto del mes. No es un compromiso: solo se basa en lo registrado.",
  };
}
