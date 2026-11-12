// Tools for Cobros (invoices issued and chased). Added to the catalogue in
// agent-tools.js, same shape as the mail tools.
import { z } from "zod";
import * as rec from "./receivables.js";
import { fail, amountField, tool, RO } from "./agent-helpers.js";
import { parseDate } from "./dates.js";

export const RECEIVABLE_INSTRUCTIONS = `Cobros: invoices the user issued to clients. receivables_list shows what is pending, overdue, paid or paused with the days late; receivable_add records one (client, amount, due date, and the client's email when the user gives it); receivable_update changes it, pauses it or marks it paid. The chase runs once a day on its own: day 1 a plain reminder, day 7 a firmer one with the amount, the reference and how to pay, day 14 no mail to the client but a notification to the user with the client's whole history. Automatic sending is off by default and only sends new notices after the user enables it. Otherwise the texts are drafts: receivable_drafts lists them, receivable_send sends one through the family's mail service (if it cannot send, the text comes back to copy) and a draft can be discarded. Never send a notice without the user asking. A payment found in the ledger that matches a pending invoice is only proposed: the user accepts it in the Cobros screen and the invoice is marked paid.`;

const findReceivable = (ref) => {
  const text = String(ref || "").trim();
  const byId = rec.getReceivable(text);
  if (byId) return byId;
  const needle = text.toLowerCase();
  const hits = rec.listReceivables({}).filter((r) => String(r.reference || "").toLowerCase() === needle
    || String(r.client || "").toLowerCase().includes(needle));
  if (hits.length === 1) return rec.getReceivable(hits[0].id);
  fail(hits.length ? `Factura "${ref}" ambigua: ${hits.map((r) => `${r.client} ${r.reference || r.id.slice(0, 8)}`).join(", ")}.`
    : `No hay ninguna factura "${ref}".`, { status: hits.length ? 400 : 404, candidates: hits.map((r) => r.id) });
};

const day = (value, name) => (value === null ? null : parseDate(String(value)) || fail(`Fecha no válida en ${name}: "${value}".`));

export const RECEIVABLE_TOOLS = [
  tool("receivables_list",
    "List invoices issued to clients: pending, overdue, paid, paused, with days late and totals. Cobros pendientes.\nstatus filters pending|overdue|paid|paused; q searches client, concept, reference and notes; sort due_date|client|amount|days|status|issued with order asc|desc. Returns the invoices, the totals (pending, overdue, collected this month) and the settings of the chase.\nSinónimos: cobros, facturas emitidas, quién me debe, facturas pendientes, vencidas, cobrado este mes, clientes que no pagan",
    z.object({
      status: z.enum(rec.STATUSES).optional(), q: z.string().max(200).default(""),
      sort: z.enum(["due_date", "client", "amount", "days", "status", "issued"]).default("due_date"),
      order: z.enum(["asc", "desc"]).default("asc"),
    }), RO,
    (a) => ({ receivables: rec.listReceivables(a), summary: rec.receivablesSummary(), settings: rec.receivableSettings() })),

  tool("receivable_add",
    "Record an invoice issued to a client, with its due date and how to pay. Nueva factura por cobrar.\nclient and amount (text, e.g. \"1.250,00\") are required; due_date (YYYY-MM-DD) is when it must be paid, issued_date defaults to today. email is the client's address (needed to send the reminders), reference the invoice number, payment_link or payment_terms how to pay, concept what it is for, notes anything else. It starts as pending and the daily check chases it.\nSinónimos: nueva factura, factura emitida, apuntar cobro, cliente que me debe, presupuesto aceptado, emitir factura, añadir cobro",
    z.object({
      client: z.string().trim().min(1).max(120), amount: amountField, due_date: z.string(),
      issued_date: z.string().optional(), email: z.string().trim().max(200).default(""), concept: z.string().trim().max(300).default(""),
      reference: z.string().trim().max(80).default(""), payment_link: z.string().trim().max(500).default(""),
      payment_terms: z.string().trim().max(2000).default(""), notes: z.string().trim().max(2000).default(""),
      currency: z.string().trim().length(3).default("EUR"),
    }), {},
    (a) => ({
      receivable: rec.present(rec.createReceivable({
        client: a.client, email: a.email, concept: a.concept, amount_cents: rec.amountToCents(a.amount), currency: a.currency,
        issued_date: a.issued_date ? day(a.issued_date, "issued_date") : undefined, due_date: day(a.due_date, "due_date"),
        reference: a.reference, notes: a.notes, payment_link: a.payment_link, payment_terms: a.payment_terms,
      })),
    })),

  tool("receivable_update",
    "Change an invoice, pause or resume the chase, or mark it paid. Editar cobro.\nref is the id or the reference. Only the fields given change; status pending|paid|paused (paid also takes paid_date). Pausing stops the reminders without losing the invoice.\nSinónimos: editar factura, cambiar importe, cambiar vencimiento, pausar cobro, marcar cobrada, ya me ha pagado, reanudar cobro, corregir factura",
    z.object({
      ref: z.string().min(1), client: z.string().trim().min(1).max(120).optional(), email: z.string().trim().max(200).optional(),
      concept: z.string().trim().max(300).optional(), amount: amountField.optional(), currency: z.string().trim().length(3).optional(),
      issued_date: z.string().optional(), due_date: z.string().optional(), reference: z.string().trim().max(80).optional(),
      notes: z.string().trim().max(2000).optional(), payment_link: z.string().trim().max(500).optional(),
      payment_terms: z.string().trim().max(2000).optional(), status: z.enum(rec.STORED_STATUSES).optional(), paid_date: z.string().optional(),
    }), { idempotentHint: true },
    (a) => {
      const current = findReceivable(a.ref);
      const patch = {};
      for (const key of ["client", "email", "concept", "currency", "reference", "notes", "payment_link", "payment_terms"]) {
        if (a[key] !== undefined) patch[key] = a[key];
      }
      if (a.amount !== undefined) patch.amount_cents = rec.amountToCents(a.amount);
      if (a.issued_date !== undefined) patch.issued_date = day(a.issued_date, "issued_date");
      if (a.due_date !== undefined) patch.due_date = day(a.due_date, "due_date");
      if (a.status === "paid") return { receivable: rec.present(rec.markPaid(current.id, { date: a.paid_date ? day(a.paid_date, "paid_date") : null })) };
      if (a.status === "paused") return { receivable: rec.present(rec.pauseReceivable(current.id, true)) };
      if (a.status === "pending") return { receivable: rec.present(rec.pauseReceivable(current.id, false)) };
      if (!Object.keys(patch).length) fail("No hay nada que cambiar: indica los campos, status o paid_date.");
      return { receivable: rec.present(rec.updateReceivable(current.id, patch)) };
    }),

  tool("receivables_check",
    "Run the chase now: prepare the notice each overdue invoice is due and escalate the oldest. Comprobar cobros.\nSame job the daily check runs: day 1 a reminder, day 7 a firmer one, day 14 a notification to the user with the client's history. Never twice for the same step. drafts: false only escalates. today (YYYY-MM-DD) is for checking a past or future date.\nSinónimos: comprobar cobros, revisar vencidas, preparar avisos, lanzar recordatorios, qué toca reclamar, ejecutar la comprobación",
    z.object({ today: z.string().optional(), drafts: z.boolean().optional() }), {},
    async (a) => {
      const settings = rec.receivableSettings();
      return rec.checkReceivables({
        ...(a.today ? { today: day(a.today, "today") } : {}), settings,
        drafts: a.drafts === undefined ? settings.auto_draft : a.drafts,
      });
    }),

  tool("receivable_drafts",
    "List the reminder drafts waiting to be sent, with the client, the amount and the text. Borradores de aviso.\nEach draft has id, receivable_id, step (1 reminder, 2 firmer, 0 thank-you), subject and body. Edit one with the API or send it with receivable_send. Automatic sending is off by default; it only runs for new notices when the user enabled it in settings.\nSinónimos: borradores, avisos por enviar, recordatorios preparados, textos de cobro, revisar antes de enviar",
    z.object({}), RO,
    () => ({ drafts: rec.listDrafts() })),

  tool("receivable_send",
    "Send one reminder draft to the client through the family's mail service. Enviar aviso de cobro.\nnotice_id from receivable_drafts. If the mail cannot be sent, nothing is marked as sent: the answer carries the text ready to copy and the reason. Ask the user before sending.\nSinónimos: enviar aviso, mandar recordatorio, enviar el correo de cobro, reclamar por correo, enviar factura",
    z.object({ notice_id: z.string().min(1) }), { openWorldHint: true },
    async ({ notice_id }) => rec.sendNotice(notice_id)),

  tool("receivable_mark_paid",
    "Mark an invoice as collected (optionally with the date and the entry that paid it). Marcar cobrada.\nref is the id or the reference. Pending reminders are discarded. The entry is only referenced, never changed.\nSinónimos: marcar cobrada, ya está pagada, cobrado, me ha pagado el cliente, cerrar factura, ingreso recibido",
    z.object({ ref: z.string().min(1), date: z.string().optional(), entry_id: z.string().optional() }), { idempotentHint: true },
    (a) => {
      const current = findReceivable(a.ref);
      return { receivable: rec.present(rec.markPaid(current.id, { date: a.date ? day(a.date, "date") : null, entry_id: a.entry_id || null })) };
    }),
];