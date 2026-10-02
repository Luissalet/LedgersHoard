// What Ledger puts on the family agenda (the hub's "Hoy" and the family calendar): subscription renewals and trial ends,
// charges that repeat every month and are expected in the window, and money people have owed the user for over 30 days.
import { today as todayLocal, daysBetween, addMonthsToDate } from "./dates.js";
import { formatCents } from "./money.js";
import { listSubscriptions } from "./subscriptions.js";
import { recurringCandidates, merchantKey } from "./recurring.js";
import { merchantMatches } from "./mail-match.js";
import { oldDebts } from "./splits.js";
import { appLink } from "./family.js";

export const DEBT_AFTER_DAYS = 30;
const money = (cents, currency = "EUR") => formatCents(cents, currency === "EUR" ? "€" : currency);
const inRange = (day, from, to) => day >= from && day <= to;
const PERIOD_TEXT = { monthly: "al mes", yearly: "al año", weekly: "a la semana", unknown: "" };

/** A renewal weighs more the closer it is and the bigger its period (a yearly charge is a surprise; a monthly one is routine). */
export function renewalPriority(period, daysLeft) {
  if (period === "yearly") return daysLeft <= 3 ? "high" : daysLeft <= 14 ? "normal" : "low";
  return daysLeft <= 1 ? "normal" : "low";
}

export function agendaItems(from, to, _sphere = "", { today = todayLocal() } = {}) {
  const items = [];
  const subs = listSubscriptions();
  for (const s of subs) {
    if (s.status === "cancelled" || s.status === "paused") continue;
    const text = s.amount_cents ? `${money(s.amount_cents, s.currency)} ${PERIOD_TEXT[s.period] || ""}`.trim() : "";
    if (s.trial_end_date && inRange(s.trial_end_date, from, to)) {
      const left = daysBetween(today, s.trial_end_date);
      items.push({ id: `ledger:trial:${s.id}:${s.trial_end_date}`, title: `Termina la prueba de ${s.merchant}`, start: s.trial_end_date, all_day: true, kind: "deadline",
        priority: left <= 1 ? "urgent" : left <= 3 ? "high" : "normal", url: appLink("#/suscripciones"), detail: text ? `Después se cobra ${text}` : "Cancela antes si no quieres seguir" });
    }
    if (s.next_charge_date && s.next_charge_date !== s.trial_end_date && inRange(s.next_charge_date, from, to)) {
      items.push({ id: `ledger:renewal:${s.id}:${s.next_charge_date}`, title: `${s.merchant} se renueva`, start: s.next_charge_date, all_day: true, kind: "renewal",
        priority: renewalPriority(s.period, daysBetween(today, s.next_charge_date)), url: appLink("#/suscripciones"), detail: text });
    }
  }
  // charges that repeat without being a subscription: the next one after the last seen, when it falls in the window
  for (const c of recurringCandidates({ to: today.slice(0, 7), months: 12 }).candidates) {
    if (c.variable || subs.some((s) => merchantMatches(c.counterparty, s.merchant) || merchantKey(c.counterparty) === s.merchant_key)) continue;
    const next = addMonthsToDate(c.last_date, c.frequency === "quarterly" ? 3 : 1);
    if (!inRange(next, from, to) || next < today) continue;
    items.push({ id: `ledger:expected:${merchantKey(c.counterparty)}:${next}`, title: `Cargo previsto: ${c.counterparty}`, start: next, all_day: true, kind: "other",
      priority: "low", url: appLink("#/movimientos"), detail: money(c.latest_amount_cents, c.currency) });
  }
  // what people owe the user for over a month: shown today (and every day it stays open) while the window reaches today
  if (inRange(today, from, to)) {
    for (const d of oldDebts(DEBT_AFTER_DAYS, today)) {
      items.push({ id: `ledger:debt:${d.person_ref || d.person}:${d.since}`, title: `${d.person} te debe ${d.balance}`, start: today, all_day: true, kind: "followup",
        priority: daysBetween(d.since, today) > 90 ? "high" : "normal", url: appLink("#/compartidos"), detail: `Desde el ${d.since}` });
    }
  }
  return items.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}

