// Tools Ledger shares with the rest of the family (the hub's rules and other apps call these exact names) and the ones for
// shared expenses and the year. Added to the catalogue in agent-tools.js.
import { z } from "zod";
import { txFind, attachDoc } from "./tx-links.js";
import { forecastMonth } from "./outlook.js";
import { addSplit, splitsBalance, splitSettle } from "./splits.js";
import { incomeFromSales } from "./sales.js";
import * as reports from "./reports.js";
import { amountField, monthField, tool, RO } from "./agent-helpers.js";
import { thisMonth } from "./dates.js";

export const FAMILY_INSTRUCTIONS = `Family: tx_find looks a movement up by amount and date (an invoice's, for example) and tx_attach_doc keeps the reference of a document of another app on it. forecast_month projects the balance at the end of a month from what repeats (subscriptions, recurring charges and income) plus the average of the other spending; it is a projection, not a promise. Shared expenses: split_add divides a movement the user paid among people (People's address book resolves names; a name that is not there is kept as written), splits_balance says who owes whom (positive: they owe the user) and split_settle records a payback; never settle more than is owed. income_from_sales books the sales of a Mercator import as income and is safe to repeat. report_year gives income and expense by month and category for a year. budget_status takes an optional category.`;

const personSpec = z.object({
  person: z.string().trim().min(1).max(200).describe("People id (or hoard://people/person/<id>) or name"),
  share: z.number().positive().max(100).optional().describe("Fraction of the movement (0.25) or percentage (25)"),
  amount: amountField.optional().describe("Their part as an amount instead of a share"),
}).refine((p) => !(p.share !== undefined && p.amount !== undefined), "Usa share o amount, no los dos.");

export const FAMILY_TOOLS = [
  tool("tx_find",
    "Find the movement that matches an amount and date, with a score. Buscar el movimiento de una factura.\nLooks for expense movements of exactly that amount within `days` (5) of the date; merchant and currency narrow it. matches[] is best first: score 1 is the same day and merchant, 0.8 or more is a strong match. amount is positive text or number; tx_id is the movement id.\nSinónimos: buscar movimiento, encontrar el pago de esta factura, a qué gasto corresponde, localizar cargo",
    z.object({ amount: amountField, date: z.string().min(8).max(30).describe("YYYY-MM-DD or DD/MM/YYYY"), merchant: z.string().max(120).optional(), days: z.number().int().min(0).max(60).default(5), currency: z.string().length(3).optional() }), RO,
    (a) => txFind(a)),

  tool("tx_attach_doc",
    "Keep the reference of a document (hoard://app/kind/id) on a movement. Adjuntar documento a un movimiento.\nDoc refs are listed on the movement and open in the app that owns them (an invoice in Kafka). Repeating it with the same ref only updates the label.\nSinónimos: adjuntar factura, asociar documento, enlazar justificante, vincular recibo al gasto",
    z.object({ tx_id: z.string().min(1), doc_ref: z.string().min(1).max(400), label: z.string().max(160).optional() }), { idempotentHint: true },
    (a) => attachDoc(a.tx_id, a.doc_ref, a.label)),

  tool("forecast_month",
    "Projected balance at the end of a month: today, expected in and out, lines. Previsión del mes.\nmonth YYYY-MM (default current, up to 12 ahead). Starts from today's balance and adds subscriptions, recurring charges, regular income and the 3-month average of other spending; each line says where it comes from. Amounts as numbers (and *_cents).\nSinónimos: cuánto me quedará a fin de mes, saldo previsto, proyección del mes, llegaré a fin de mes, previsión de caja",
    z.object({ month: monthField }), RO,
    ({ month }) => forecastMonth({ month: month || thisMonth() })),

  tool("split_add",
    "Split a movement you paid among people who owe a share. Repartir un gasto entre personas.\nparticipants[]: person (id or name) with share (fraction or percent) or amount; with neither, equal parts including you. Names are looked up in People; one that is not there is kept as written. Repeating it updates their share.\nSinónimos: dividir un gasto, gasto compartido, repartir la cuenta, a medias, me deben, pagué yo",
    z.object({ tx_id: z.string().min(1), participants: z.array(personSpec).min(1).max(20) }), { idempotentHint: true },
    (a) => addSplit(a)),

  tool("splits_balance",
    "Who owes whom from shared expenses, optionally for one person. Saldos de gastos compartidos.\nEach balance: owed, paid back, balance (positive: the person owes you), oldest open date and the expenses behind it.\nSinónimos: quién me debe, cuánto me debe, deudas compartidas, saldo con una persona, cuentas pendientes",
    z.object({ person: z.string().trim().max(200).optional() }), RO,
    (a) => splitsBalance(a)),

  tool("split_settle",
    "Record that a person paid back an amount of a shared expense. Saldar deuda compartida.\nOnly up to what they owe. tx_id optionally points at the income movement that received the money.\nSinónimos: me ha pagado, liquidar deuda, saldar cuentas, devolver lo que debía, cobrar a un amigo",
    z.object({ person: z.string().trim().min(1).max(200), amount: amountField, tx_id: z.string().optional(), note: z.string().max(300).optional() }), {},
    (a) => splitSettle(a)),

  tool("income_from_sales",
    "Book the sales of a Mercator import as income, once per batch line. Apuntar ventas como ingresos.\nReads the batch from Mercator (the hub), adds one income movement per currency and day and remembers each line, so repeating it adds nothing. account and category are optional (an income category named like sales is used when it exists).\nSinónimos: ingresos por ventas, apuntar ventas, importar ventas de Mercator, cobros de la tienda",
    z.object({ batch: z.string().min(1).max(120), account: z.string().optional(), category: z.string().optional() }), { idempotentHint: true, openWorldHint: true },
    (a) => incomeFromSales(a)),

  tool("report_year",
    "Year report: income and expense by month and category. Informe anual.\nyear (default last year if it is January to March, else the current one). Cents; transfers excluded; by_month_spent_cents per category runs January to December. currencies[] when accounts differ.\nSinónimos: resumen del año, totales anuales, gasto por categoría del año, para la declaración de la renta, cuánto gasté este año",
    z.object({ year: z.number().int().min(1970).max(2200).optional() }), RO,
    ({ year }) => reports.yearReport(year ?? (new Date().getMonth() < 3 ? new Date().getFullYear() - 1 : new Date().getFullYear()))),
];
