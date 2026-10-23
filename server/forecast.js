// Saved what-if cash-flow scenarios. Projections never write to entries.
import { z } from "zod";
import { db, uid, now } from "./db.js";
import { accountBalances, getAccount } from "./accounts.js";
import { addMonths, isMonth, monthRange, thisMonth } from "./dates.js";

const bad = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const month = z.string().refine(isMonth, "Mes no válido (YYYY-MM)");
const lineInput = z.object({
  account_id: z.string().min(1),
  label: z.string().trim().min(1).max(120),
  start_month: month,
  end_month: month.nullable().default(null),
  cadence: z.enum(["once", "monthly", "quarterly"]).default("once"),
  amount_cents: z.number().int().safe().refine((v) => v !== 0, "El importe no puede ser cero"),
});

export function listScenarios() {
  return db().prepare("SELECT * FROM scenarios ORDER BY created_at, id").all();
}
export function getScenario(id) {
  const scenario = db().prepare("SELECT * FROM scenarios WHERE id = ?").get(id);
  if (!scenario) return null;
  return { ...scenario, lines: db().prepare("SELECT * FROM scenario_lines WHERE scenario_id = ? ORDER BY start_month, created_at, id").all(id) };
}
export function createScenario(input) {
  const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(input);
  const id = uid();
  db().prepare("INSERT INTO scenarios (id, name, created_at) VALUES (?, ?, ?)").run(id, name, now());
  return getScenario(id);
}
export function updateScenario(id, input) {
  if (!getScenario(id)) return null;
  const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(input);
  db().prepare("UPDATE scenarios SET name = ? WHERE id = ?").run(name, id);
  return getScenario(id);
}
export function deleteScenario(id) {
  return db().prepare("DELETE FROM scenarios WHERE id = ?").run(id).changes > 0;
}
export function addScenarioLine(id, input) {
  if (!getScenario(id)) bad("Escenario no encontrado.", 404);
  const line = lineInput.parse(input);
  if (!getAccount(line.account_id)) bad("Cuenta no encontrada.");
  if (line.end_month && line.end_month < line.start_month) bad("El fin precede al inicio.");
  if (line.cadence === "once" && line.end_month && line.end_month !== line.start_month) bad("Un movimiento puntual solo tiene un mes.");
  const lineId = uid();
  db().prepare(`INSERT INTO scenario_lines
    (id, scenario_id, account_id, label, start_month, end_month, cadence, amount_cents, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(lineId, id, line.account_id, line.label,
      line.start_month, line.end_month, line.cadence, line.amount_cents, now());
  return db().prepare("SELECT * FROM scenario_lines WHERE id = ?").get(lineId);
}
export function updateScenarioLine(id, lineId, input) {
  const current = db().prepare("SELECT * FROM scenario_lines WHERE id = ? AND scenario_id = ?").get(lineId, id);
  if (!current) return null;
  const next = lineInput.parse({ ...current, ...input });
  if (!getAccount(next.account_id)) bad("Cuenta no encontrada.");
  if (next.end_month && next.end_month < next.start_month) bad("El fin precede al inicio.");
  if (next.cadence === "once" && next.end_month && next.end_month !== next.start_month) bad("Un movimiento puntual solo tiene un mes.");
  db().prepare(`UPDATE scenario_lines SET account_id = ?, label = ?, start_month = ?, end_month = ?, cadence = ?, amount_cents = ?
    WHERE id = ? AND scenario_id = ?`).run(next.account_id, next.label, next.start_month,
      next.end_month, next.cadence, next.amount_cents, lineId, id);
  return db().prepare("SELECT * FROM scenario_lines WHERE id = ?").get(lineId);
}
export function deleteScenarioLine(id, lineId) {
  return db().prepare("DELETE FROM scenario_lines WHERE id = ? AND scenario_id = ?").run(lineId, id).changes > 0;
}

export function forecast({ scenario_id = null, from = addMonths(thisMonth(), 1), months = 6 } = {}) {
  if (!isMonth(from) || !Number.isInteger(months) || months < 1 || months > 24) bad("Usa un mes YYYY-MM y un horizonte de 1 a 24 meses.");
  const scenario = scenario_id ? getScenario(scenario_id) : null;
  if (scenario_id && !scenario) bad("Escenario no encontrado.", 404);
  const projectedDelta = new Map();
  const rows = [];
  for (let i = 0; i < months; i++) {
    const currentMonth = addMonths(from, i);
    const accounts = accountBalances(monthRange(currentMonth).to);
    const lines = (scenario?.lines || []).filter((line) =>
      line.start_month <= currentMonth &&
      (!line.end_month || currentMonth <= line.end_month) &&
      (line.cadence === "monthly" || (line.cadence === "quarterly"
        ? (Number(currentMonth.slice(0, 4)) * 12 + Number(currentMonth.slice(5, 7))
          - Number(line.start_month.slice(0, 4)) * 12 - Number(line.start_month.slice(5, 7))) % 3 === 0
        : line.start_month === currentMonth)));
    const byAccount = accounts.map((account) => {
      const base_balance = account.balance;
      const accountLines = lines.filter((line) => line.account_id === account.id);
      const change = accountLines.reduce((sum, line) => sum + line.amount_cents, 0);
      const cumulativeDelta = (projectedDelta.get(account.id) || 0) + change;
      projectedDelta.set(account.id, cumulativeDelta);
      return { account_id: account.id, name: account.name, currency: account.currency,
        base_balance, change, balance: base_balance + cumulativeDelta };
    });
    const currencies = [...new Set(byAccount.map((a) => a.currency))];
    const oneCurrency = currencies.length <= 1;
    rows.push({ month: currentMonth, currency: oneCurrency ? (currencies[0] || "EUR") : null,
      base_balance: oneCurrency ? byAccount.reduce((s, a) => s + a.base_balance, 0) : null,
      change: oneCurrency ? lines.reduce((s, line) => s + line.amount_cents, 0) : null,
      balance: oneCurrency ? byAccount.reduce((s, a) => s + a.balance, 0) : null, accounts: byAccount,
      lines: lines.map((line) => ({ ...line, source: "assumption" })) });
  }
  return { from, months, scenario, rows, note: "El saldo base incluye los movimientos registrados hasta el final de cada mes. Los supuestos se acumulan desde el mes inicial de la proyección; no se infieren pagos futuros." };
}

export function compareForecasts({ scenario_id = null, comparison_id = null, from, months = 6 } = {}) {
  const left = forecast({ scenario_id, from, months });
  const right = forecast({ scenario_id: comparison_id, from, months });
  const rows = left.rows.map((row, index) => {
    const accounts = row.accounts.map((account, accountIndex) => {
      const other = right.rows[index].accounts[accountIndex];
      return { account_id: account.account_id, name: account.name, currency: account.currency,
        base_balance: account.base_balance, left_balance: account.balance, right_balance: other.balance,
        difference: other.balance - account.balance, monthly_difference: other.change - account.change };
    });
    const currencies = [...new Set(accounts.map((account) => account.currency))].map((currency) => {
      const selected = accounts.filter((account) => account.currency === currency);
      return { currency, ...Object.fromEntries(["base_balance", "left_balance", "right_balance", "difference", "monthly_difference"]
        .map((key) => [key, selected.reduce((sum, account) => sum + account[key], 0)])) };
    });
    return { month: row.month, accounts, currencies };
  });
  return { from: left.from, months, left: left.scenario, right: right.scenario, rows,
    note: left.note, difference_note: "Las diferencias son B menos A. Cada divisa se calcula por separado, sin conversión." };
}
