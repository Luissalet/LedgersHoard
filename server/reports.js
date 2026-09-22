// Aggregations: monthly summary, budget status, per-month report.
import { db } from "./db.js";
import { listCategories } from "./categories.js";
import { accountBalances } from "./accounts.js";
import { monthRange, monthsBetween, thisMonth } from "./dates.js";
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
    categories: lines.map(({ id, name, budget, spent, remaining, pct, over }) => ({ id, name, budget, spent, remaining, pct, over })),
    total_budget: totalBudget,
    total_spent: totalSpent,
    total_remaining: totalBudget - totalSpent,
    over_count: over.length,
    verdict,
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
