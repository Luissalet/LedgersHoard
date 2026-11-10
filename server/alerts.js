// Alerts that depend on the calendar or on what was just recorded: reminders before a subscription renews (so there is
// time to cancel it), trial ends, and a category that reaches or passes its monthly budget. Each alert is raised once
// (notifications.js dedupe key) and travels like every other Ledger notification: the list in the app, the family bus and
// the hub's notification facet with the Windows toast as the fallback.
import { z } from "zod";
import { getSetting, setSetting } from "./db.js";
import { today as todayLocal } from "./dates.js";
import { formatCents } from "./money.js";
import { categoryLines } from "./reports.js";
import { notify } from "./notifications.js";
import { sweepAlerts } from "./subscriptions.js";
import { appLink } from "./family.js";

export const ALERT_KEYS = {
  renew_days: ["alerts.renew_days", 3],
  renew_days_yearly: ["alerts.renew_days_yearly", 7],
  budget: ["alerts.budget", 1],
  budget_warn_pct: ["alerts.budget_warn_pct", 80],
};

const flag = z.union([z.boolean(), z.number().int().min(0).max(1)]).transform((v) => (v === true || v === 1 ? 1 : 0));
export const alertSettingsPatch = z.object({
  renew_days: z.number().int().min(0).max(30),
  renew_days_yearly: z.number().int().min(0).max(60),
  budget: flag,
  budget_warn_pct: z.number().int().min(0).max(99),
}).partial().strict();

export function alertSettings() {
  const out = {};
  for (const [name, [key, fallback]] of Object.entries(ALERT_KEYS)) out[name] = Number(getSetting(key, fallback));
  out.budget = Boolean(out.budget);
  return out;
}

export function updateAlertSettings(patch) {
  const data = alertSettingsPatch.parse(patch || {});
  for (const [name, value] of Object.entries(data)) setSetting(ALERT_KEYS[name][0], value);
  return alertSettings();
}

const money = (cents) => formatCents(cents, "€");

/**
 * Budget alerts for a month: a category that reaches `budget_warn_pct` of its budget (0 = no early warning) and one that
 * goes over it. Once per category, month and level.
 */
export async function sweepBudgets(today = todayLocal(), settings = alertSettings()) {
  if (!settings.budget) return 0;
  const month = today.slice(0, 7);
  let created = 0;
  for (const line of categoryLines(month)) {
    if (line.kind !== "expense" || !line.budget || line.budget <= 0 || !line.id) continue;
    const pct = Math.round((line.spent / line.budget) * 100);
    const payload = { category_id: line.id, category: line.name, month, spent: line.spent / 100, budget: line.budget / 100, spent_cents: line.spent, budget_cents: line.budget, pct, url: appLink("#/resumen") };
    let a = null;
    if (line.spent > line.budget) {
      a = await notify({
        kind: "budget.over", severity: "medium", title: `Presupuesto de ${line.name} superado`,
        body: `${money(line.spent)} de ${money(line.budget)} este mes (${pct} %), ${money(line.spent - line.budget)} por encima.`,
        dedupe_key: `budget:over:${line.id}:${month}`, event: "ledger.budget.over", url: appLink("#/resumen"), payload,
      });
    } else if (settings.budget_warn_pct > 0 && line.spent * 100 >= line.budget * settings.budget_warn_pct) {
      a = await notify({
        kind: "budget.warning", severity: "medium", title: `${line.name}: llevas el ${pct} % del presupuesto`,
        body: `${money(line.spent)} de ${money(line.budget)} este mes; quedan ${money(line.budget - line.spent)}.`,
        dedupe_key: `budget:warn:${line.id}:${month}`, event: "ledger.budget.warning", url: appLink("#/resumen"), payload,
      });
    }
    if (a) created++;
  }
  return created;
}

/** Every time-based alert: subscription renewals and trial ends, then budgets. Returns how many alerts were created. */
export async function sweepAll(today = todayLocal()) {
  const settings = alertSettings();
  const subs = await sweepAlerts(today, { renewDays: settings.renew_days, renewDaysYearly: settings.renew_days_yearly });
  const budgets = await sweepBudgets(today, settings);
  return subs + budgets;
}

/**
 * Express middleware: after a write to the API answers OK, check the budgets (debounced), so an entry recorded from the
 * interface, the assistant or an import raises its budget alert at once.
 */
export function budgetWatch({ delayMs = 800 } = {}) {
  let timer = null;
  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD" && req.path.startsWith("/api/") && !req.path.startsWith("/api/copilot")) {
      res.on("finish", () => {
        if (res.statusCode >= 400) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { timer = null; sweepBudgets().catch(() => {}); }, delayMs);
        timer.unref?.();
      });
    }
    next();
  };
}

/** Hourly sweep in the app process (the mail scan also runs it); the first one shortly after start. */
export function startAlertLoop({ firstDelayMs = 40_000, everyMs = 60 * 60_000 } = {}) {
  const run = () => sweepAll().catch(() => {});
  const first = setTimeout(run, firstDelayMs);
  const every = setInterval(run, everyMs);
  first.unref?.(); every.unref?.();
  return () => { clearTimeout(first); clearInterval(every); };
}
