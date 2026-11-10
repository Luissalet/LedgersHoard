// Aggregations: monthly summary, budget status, per-month report.
import { db } from "./db.js";
import { listCategories } from "./categories.js";
import { accountBalances } from "./accounts.js";
import { monthRange, monthsBetween, thisMonth, addMonths, today as todayLocal } from "./dates.js";
import { getCategory } from "./categories.js";
import { formatCents } from "./money.js";

/** Totals for a date range, transfers excluded. */
function totals(from, to) {
  const r = db().prepare(
    `SELECT COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS income,
            COALESCE(SUM(CASE WHEN amount_cents < 0 THEN -amount_cents ELSE 0 END), 0) AS expense
     FROM entries WHERE date >= ? AND date <= ? AND transfer_id IS NULL`,
  ).get(from, to);
  return { income: r.income, expense: r.expense, net: r.income - r.expense };
}

/** Spent/earned per category in a range (absolute cents), keyed by category id ("" = uncategorised). */
function byCategoryRaw(from, to) {
  const rows = db().prepare(
    `SELECT COALESCE(category_id, '') AS category_id,
            COALESCE(SUM(CASE WHEN amount_cents < 0 THEN -amount_cents ELSE 0 END), 0) AS spent,
            COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS earned,
            COUNT(*) AS count
     FROM entries WHERE date >= ? AND date <= ? AND transfer_id IS NULL
     GROUP BY category_id`,
  ).all(from, to);
  return new Map(rows.map((r) => [r.category_id, r]));
}

/**
 * Category lines for a month: every active category (plus archived ones with
 * movements) with spent, earned, budget, remaining, pct and over flag.
 * Budgets only apply to expense categories; income lines carry budget null.
 */
export function categoryLines(month) {
  const { from, to } = monthRange(month);
  const raw = byCategoryRaw(from, to);
  const lines = [];
  for (const c of listCategories()) {
    const r = raw.get(c.id);
    if (c.archived && !r) continue;
    const spent = r?.spent || 0;
    const earned = r?.earned || 0;
    const budget = c.kind === "expense" ? c.monthly_budget : null;
    const remaining = budget == null ? null : budget - spent;
    const pct = budget ? Math.round((spent / budget) * 100) : null;
    lines.push({
      id: c.id, name: c.name, kind: c.kind, parent_id: c.parent_id, color: c.color, archived: c.archived,
      spent, earned, count: r?.count || 0, budget, remaining, pct, over: budget != null && spent > budget,
    });
  }
  const none = raw.get("");
  if (none) {
    lines.push({
      id: null, name: "Sin categoría", kind: "expense", parent_id: null, color: null, archived: false,
      spent: none.spent, earned: none.earned, count: none.count, budget: null, remaining: null, pct: null, over: false,
    });
  }
  return lines;
}

export function summary(month = thisMonth()) {
  const { from, to } = monthRange(month);
  const lines = categoryLines(month);
  const budgeted = lines.filter((l) => l.budget != null);
  return {
    month,
    from,
    to,
    ...totals(from, to),
    categories: lines,
    budget: {
      total: budgeted.reduce((s, l) => s + l.budget, 0),
      spent: budgeted.reduce((s, l) => s + l.spent, 0),
      over: budgeted.filter((l) => l.over).length,
    },
    accounts: accountBalances(),
  };
}

export function budgetStatus(month = thisMonth()) {
  const lines = categoryLines(month).filter((l) => l.kind === "expense" && l.id);
  const withBudget = lines.filter((l) => l.budget != null);
  const over = withBudget.filter((l) => l.over);
  const totalBudget = withBudget.reduce((s, l) => s + l.budget, 0);
  const totalSpent = withBudget.reduce((s, l) => s + l.spent, 0);
  let verdict;
  if (!withBudget.length) verdict = `No hay presupuestos definidos para ${month}.`;
  else if (over.length) verdict = `${month}: ${over.length} de ${withBudget.length} presupuestos superados (${over.map((l) => l.name).join(", ")}); gastado ${formatCents(totalSpent)} de ${formatCents(totalBudget)}.`;
  else verdict = `${month}: dentro de presupuesto, gastado ${formatCents(totalSpent)} de ${formatCents(totalBudget)} (queda ${formatCents(totalBudget - totalSpent)}).`;
  return {
    month,
    categories: lines.map(({ id, name, budget, spent, remaining, pct, over }) => ({ id, name, category: name, budget, spent, remaining, left: remaining, pct, over })),
    total_budget: totalBudget,
    total_spent: totalSpent,
    total_remaining: totalBudget - totalSpent,
    over_count: over.length,
    verdict,
  };
}

const pctChange = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);

/**
 * A month against the ones before it: totals and spending per category against the previous month and the average of the
 * three full months before. For the month in progress it also compares with the previous month up to the same day, so a
 * half month is not set against a whole one. Transfers excluded; cents.
 */
export function monthCompare(month = thisMonth(), today = todayLocal()) {
  const { from, to } = monthRange(month);
  const current = today >= from && today <= to;
  const cut = current ? today : to;
  const prev = addMonths(month, -1);
  const prevRange = monthRange(prev);
  const day = Number(cut.slice(8));
  const prevCut = `${prev}-${String(Math.min(day, Number(prevRange.to.slice(8)))).padStart(2, "0")}`;
  const avgMonths = [addMonths(month, -3), addMonths(month, -2), prev];
  const avgRange = { from: monthRange(avgMonths[0]).from, to: prevRange.to };

  const now = totals(from, cut);
  const before = totals(prevRange.from, prevRange.to);
  const beforeSameDay = current ? totals(prevRange.from, prevCut) : null;
  const avgTotals = totals(avgRange.from, avgRange.to);
  const avg = { income: Math.round(avgTotals.income / 3), expense: Math.round(avgTotals.expense / 3), net: Math.round(avgTotals.net / 3) };

  const nowCat = byCategoryRaw(from, cut);
  const prevCat = byCategoryRaw(prevRange.from, prevRange.to);
  const sameCat = current ? byCategoryRaw(prevRange.from, prevCut) : null;
  const avgCat = byCategoryRaw(avgRange.from, avgRange.to);
  const ids = new Set([...nowCat.keys(), ...prevCat.keys(), ...avgCat.keys()]);
  const categories = [];
  for (const id of ids) {
    const cat = id ? getCategory(id) : null;
    if (cat && cat.kind !== "expense") continue;
    const spent = nowCat.get(id)?.spent || 0;
    const previous = prevCat.get(id)?.spent || 0;
    const average = Math.round((avgCat.get(id)?.spent || 0) / 3);
    if (!spent && !previous && !average) continue;
    const sameDay = sameCat ? (sameCat.get(id)?.spent || 0) : null;
    categories.push({
      id: id || null, name: cat?.name || "Sin categoría", color: cat?.color || null, budget: cat?.monthly_budget ?? null,
      spent, previous, previous_same_day: sameDay, average,
      delta_previous: spent - (current ? sameDay : previous), delta_average: spent - average,
      pct_previous: pctChange(spent, current ? sameDay : previous), pct_average: current ? null : pctChange(spent, average),
    });
  }
  categories.sort((a, b) => Math.abs(b.delta_previous) - Math.abs(a.delta_previous) || b.spent - a.spent);
  const ref = current ? beforeSameDay.expense : before.expense;
  const diff = now.expense - ref;
  const verdict = !now.expense && !ref
    ? `Sin gastos en ${month} ni en ${prev}.`
    : `${month}${current ? ` hasta el día ${day}` : ""}: gastado ${formatCents(now.expense)}, ${diff === 0 ? "igual que" : `${formatCents(Math.abs(diff))} ${diff > 0 ? "más" : "menos"} que`} ${prev}${current ? " a estas alturas" : ""}${pctChange(now.expense, ref) != null && diff ? ` (${diff > 0 ? "+" : ""}${pctChange(now.expense, ref)} %)` : ""}; la media de los 3 meses anteriores es ${formatCents(avg.expense)} al mes.`;
  return {
    month, previous_month: prev, average_months: avgMonths, in_progress: current, cut, previous_cut: current ? prevCut : prevRange.to,
    totals: now, previous: before, previous_same_day: beforeSameDay, average: avg,
    expense_delta_previous: diff, expense_pct_previous: pctChange(now.expense, ref),
    categories, verdict,
  };
}

/** Per-month income/expense/net between two months (inclusive). */
export function monthsReport(from, to) {
  const rows = db().prepare(
    `SELECT substr(date, 1, 7) AS month,
            COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS income,
            COALESCE(SUM(CASE WHEN amount_cents < 0 THEN -amount_cents ELSE 0 END), 0) AS expense
     FROM entries WHERE date >= ? AND date <= ? AND transfer_id IS NULL
     GROUP BY month ORDER BY month`,
  ).all(monthRange(from).from, monthRange(to).to);
  const map = new Map(rows.map((r) => [r.month, r]));
  return monthsBetween(from, to).map((month) => {
    const r = map.get(month) || { income: 0, expense: 0 };
    return { month, income: r.income, expense: r.expense, net: r.income - r.expense };
  });
}

/**
 * A calendar year in one answer: income, expense and net per month and per category (transfers excluded), by currency of
 * the account. The top level is the currency with the most movements; `currencies` lists them all.
 */
export function yearReport(year) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 1970 || y > 2200) throw Object.assign(new Error("Año no válido."), { status: 400 });
  const rows = db().prepare(
    `SELECT a.currency AS currency, substr(e.date, 1, 7) AS month, e.category_id AS category_id,
            COALESCE(SUM(CASE WHEN e.amount_cents > 0 THEN e.amount_cents ELSE 0 END), 0) AS income,
            COALESCE(SUM(CASE WHEN e.amount_cents < 0 THEN -e.amount_cents ELSE 0 END), 0) AS expense, COUNT(*) AS n
     FROM entries e JOIN accounts a ON a.id = e.account_id
     WHERE e.date >= ? AND e.date <= ? AND e.transfer_id IS NULL GROUP BY a.currency, month, e.category_id`,
  ).all(`${y}-01-01`, `${y}-12-31`);
  const months = monthsBetween(`${y}-01`, `${y}-12`);
  const byCurrency = new Map();
  for (const r of rows) {
    if (!byCurrency.has(r.currency)) byCurrency.set(r.currency, { currency: r.currency, count: 0, months: new Map(months.map((m) => [m, { income: 0, expense: 0 }])), cats: new Map() });
    const c = byCurrency.get(r.currency);
    c.count += r.n;
    const m = c.months.get(r.month);
    m.income += r.income;
    m.expense += r.expense;
    const key = r.category_id || "";
    if (!c.cats.has(key)) c.cats.set(key, { category_id: r.category_id || null, spent_cents: 0, earned_cents: 0, count: 0, by_month: months.map(() => 0) });
    const cat = c.cats.get(key);
    cat.spent_cents += r.expense;
    cat.earned_cents += r.income;
    cat.count += r.n;
    cat.by_month[months.indexOf(r.month)] += r.expense - r.income;
  }
  const shape = (c) => {
    const list = [...c.months.entries()].map(([month, v]) => ({ month, income_cents: v.income, expense_cents: v.expense, net_cents: v.income - v.expense }));
    const income = list.reduce((s, m) => s + m.income_cents, 0);
    const expense = list.reduce((s, m) => s + m.expense_cents, 0);
    const categories = [...c.cats.values()].map((x) => {
      const cat = x.category_id ? getCategory(x.category_id) : null;
      return { category: cat?.name || "Sin categoría", kind: cat?.kind || (x.earned_cents > x.spent_cents ? "income" : "expense"), category_id: x.category_id, spent_cents: x.spent_cents, earned_cents: x.earned_cents, count: x.count, by_month_spent_cents: x.by_month };
    }).sort((a, b) => b.spent_cents - a.spent_cents || b.earned_cents - a.earned_cents);
    return { currency: c.currency, movements: c.count, income_cents: income, expense_cents: expense, net_cents: income - expense,
      income: formatCents(income), expense: formatCents(expense), net: formatCents(income - expense), by_month: list, by_category: categories };
  };
  const all = [...byCurrency.values()].sort((a, b) => b.count - a.count).map(shape);
  const top = all[0] || { currency: "EUR", movements: 0, income_cents: 0, expense_cents: 0, net_cents: 0, income: formatCents(0), expense: formatCents(0), net: formatCents(0), by_month: months.map((month) => ({ month, income_cents: 0, expense_cents: 0, net_cents: 0 })), by_category: [] };
  return { ok: true, year: y, ...top, currencies: all, note: "Cantidades en céntimos. by_month_spent_cents de cada categoría es el gasto neto de cada mes (enero a diciembre); los traspasos no cuentan." };
}
