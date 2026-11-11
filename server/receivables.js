// Cobros: invoices issued to clients and the notices that chase them. Each
// morning (the mail scheduler's daily hook, never a loop of its own) an
// overdue invoice gets the notice of its step: day 1 a plain reminder, day 7 a
// firmer one with the amount, the reference and how to pay, day 14 no mail to
// the client at all but a notification to the user with the client's whole
// history. One notice per step and invoice (unique index), so running the check
// twice adds nothing. Texts come from sober Spanish templates; when the family
// model is available it rewrites them and the template stays as the fallback.
// A payment found in the ledger that matches a pending invoice is proposed, not
// booked: the user says yes and the invoice is marked paid.
import { z } from "zod";
import { db, uid, now, getSetting, setSetting, transaction } from "./db.js";
import { today as todayLocal, parseDate, daysBetween } from "./dates.js";
import { formatCents, parseAmount } from "./money.js";
import { notify } from "./notifications.js";
import { appLink } from "./family.js";
import { merchantMatches } from "./mail-match.js";
import { fold } from "./hoard-commons/text.js";
import { chat } from "./hoard-link.js";
import { mailSource } from "./mail-source.js";

const fail = (message, status = 400, extra = {}) => { throw Object.assign(new Error(message), { status, ...extra }); };
const money = (cents, currency = "EUR") => formatCents(cents, currency === "EUR" ? "€" : currency);

/** Stored states; "overdue" is derived from the due date, never stored. */
export const STORED_STATUSES = ["pending", "paid", "paused"];
export const STATUSES = ["pending", "overdue", "paid", "paused"];
export const TONES = ["sobrio", "cercano", "formal"];
export const STEP_LABEL = { 0: "Agradecimiento", 1: "Aviso 1", 2: "Aviso 2", 3: "Aviso al usuario" };

// ---------------------------------------------------------------- settings
export const RECEIVABLE_KEYS = {
  step1_days: ["receivables.step1_days", 1],
  step2_days: ["receivables.step2_days", 7],
  escalate_days: ["receivables.escalate_days", 14],
  tone: ["receivables.tone", "sobrio"],
  auto_draft: ["receivables.auto_draft", 1],
  use_model: ["receivables.use_model", 1],
  signature: ["receivables.signature", ""],
};

const flag = z.union([z.boolean(), z.number().int().min(0).max(1)]).transform((v) => (v === true || v === 1 ? 1 : 0));

export const settingsPatch = z.object({
  step1_days: z.number().int().min(0).max(60),
  step2_days: z.number().int().min(1).max(120),
  escalate_days: z.number().int().min(2).max(365),
  tone: z.enum(TONES),
  auto_draft: flag,
  use_model: flag,
  signature: z.string().trim().max(120),
}).partial().strict();

export function receivableSettings() {
  const out = {};
  for (const [name, [key, fallback]] of Object.entries(RECEIVABLE_KEYS)) out[name] = getSetting(key, fallback);
  out.auto_draft = Boolean(Number(out.auto_draft));
  out.use_model = Boolean(Number(out.use_model));
  return out;
}

export function updateReceivableSettings(patch) {
  const data = settingsPatch.parse(patch || {});
  const next = { ...receivableSettings(), ...data };
  if (!(next.step1_days < next.step2_days && next.step2_days < next.escalate_days)) {
    fail("Los plazos tienen que ir en orden: primer aviso < segundo aviso < aviso al usuario.");
  }
  for (const [name, value] of Object.entries(data)) setSetting(RECEIVABLE_KEYS[name][0], value);
  return receivableSettings();
}

// ---------------------------------------------------------------- rows
const row = (r) => (r ? { ...r } : null);

/** Days past the due date (negative: still to come), null without a due date. */
const overdueDays = (r, today) => daysBetween(r.due_date, today);

export function present(r, { today = todayLocal() } = {}) {
  if (!r) return null;
  const days = overdueDays(r, today);
  const status = r.status === "pending" && days !== null && days > 0 ? "overdue" : r.status;
  const notices = db().prepare("SELECT state, step, ts FROM receivable_notices WHERE receivable_id = ? ORDER BY step").all(r.id);
  return {
    ...r,
    amount: money(r.amount_cents, r.currency),
    status,
    days_overdue: r.status === "paid" ? 0 : Math.max(0, days ?? 0),
    days_to_due: Math.max(0, -(days ?? 0)),
    notices_count: notices.length,
    drafts_count: notices.filter((n) => n.state === "draft").length,
    last_notice: notices.length ? notices[notices.length - 1] : null,
  };
}

export function getReceivable(id) {
  return row(db().prepare("SELECT * FROM receivables WHERE id = ?").get(String(id || "")));
}

export function getNotice(id) {
  return row(db().prepare("SELECT * FROM receivable_notices WHERE id = ?").get(String(id || "")));
}

const presentNotice = (n) => (n ? { ...n, step_label: STEP_LABEL[n.step] || `Paso ${n.step}` } : null);

/** One invoice with its notice timeline and the payments waiting for a yes. */
export function receivableDetail(id, { today = todayLocal() } = {}) {
  const r = getReceivable(id) || fail("No existe esa factura.", 404);
  const notices = db().prepare("SELECT * FROM receivable_notices WHERE receivable_id = ? ORDER BY step, ts").all(r.id).map(presentNotice);
  const proposals = db().prepare(
    `SELECT p.*, e.date, e.amount_cents, e.counterparty, e.note FROM receivable_proposals p
     JOIN entries e ON e.id = p.entry_id WHERE p.receivable_id = ? ORDER BY p.created_at DESC`,
  ).all(r.id).map((p) => ({ ...p, amount: money(p.amount_cents) }));
  return { receivable: present(r, { today }), notices, proposals };
}

export function listReceivables({ status = null, q = "", sort = "due_date", order = "asc", today = todayLocal() } = {}) {
  const rows = db().prepare("SELECT * FROM receivables ORDER BY due_date, client").all().map((r) => present(r, { today }));
  const needle = fold(String(q || "").trim());
  let items = rows;
  if (status) items = items.filter((r) => r.status === status);
  if (needle) items = items.filter((r) => fold(`${r.client} ${r.concept} ${r.reference} ${r.email} ${r.notes}`).includes(needle));
  const key = { due_date: "due_date", client: "client", amount: "amount_cents", days: "days_overdue", status: "status", issued: "issued_date" }[sort] || "due_date";
  const dir = order === "desc" ? -1 : 1;
  items.sort((a, b) => {
    const x = a[key], y = b[key];
    const cmp = typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""), "es");
    return cmp * dir || String(a.client).localeCompare(String(b.client), "es");
  });
  return items;
}

/** Totals for the screen: what is pending, what is overdue and what was collected this month. */
export function receivablesSummary({ today = todayLocal() } = {}) {
  const items = listReceivables({ today });
  const month = today.slice(0, 7);
  const sum = (list) => list.reduce((n, r) => n + r.amount_cents, 0);
  const pending = items.filter((r) => r.status === "pending");
  const overdue = items.filter((r) => r.status === "overdue");
  const paid = items.filter((r) => r.status === "paid" && String(r.paid_date || "").startsWith(month));
  const paused = items.filter((r) => r.status === "paused");
  return {
    month,
    counts: { pending: pending.length, overdue: overdue.length, paid: paid.length, paused: paused.length, total: items.length },
    pending_cents: sum(pending), pending: money(sum(pending)),
    overdue_cents: sum(overdue), overdue: money(sum(overdue)),
    paid_cents: sum(paid), paid: money(sum(paid)),
    paused_cents: sum(paused), paused: money(sum(paused)),
    drafts: db().prepare("SELECT COUNT(*) AS n FROM receivable_notices WHERE state = 'draft'").get().n,
    proposals: db().prepare("SELECT COUNT(*) AS n FROM receivable_proposals WHERE state = 'pending'").get().n,
  };
}

// ---------------------------------------------------------------- write
const text = (value, max) => String(value ?? "").trim().slice(0, max);

export const receivableInput = z.object({
  client: z.string().trim().min(1).max(120),
  email: z.string().trim().max(200).default(""),
  concept: z.string().trim().max(300).default(""),
  amount_cents: z.number().int().positive(),
  currency: z.string().trim().length(3).default("EUR"),
  issued_date: z.string().optional(),
  due_date: z.string(),
  reference: z.string().trim().max(80).default(""),
  notes: z.string().trim().max(2000).default(""),
  payment_link: z.string().trim().max(500).default(""),
  payment_terms: z.string().trim().max(2000).default(""),
});

const day = (value, name) => {
  const parsed = parseDate(String(value || ""));
  if (!parsed) fail(`Fecha no válida en ${name}: "${value}".`);
  return parsed;
};

export function createReceivable(input) {
  const data = receivableInput.parse(input || {});
  const issued = data.issued_date ? day(data.issued_date, "issued_date") : todayLocal();
  const due = day(data.due_date, "due_date");
  if (due < issued) fail("El vencimiento no puede ser anterior a la fecha de emisión.");
  const id = uid();
  const ts = now();
  db().prepare(
    `INSERT INTO receivables (id, client, email, concept, amount_cents, currency, issued_date, due_date, status, reference, notes,
       payment_link, payment_terms, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
  ).run(id, text(data.client, 120), text(data.email, 200), text(data.concept, 300), data.amount_cents, data.currency.toUpperCase(),
    issued, due, text(data.reference, 80), text(data.notes, 2000), text(data.payment_link, 500), text(data.payment_terms, 2000), ts, ts);
  return getReceivable(id);
}

export const receivablePatch = z.object({
  client: z.string().trim().min(1).max(120),
  email: z.string().trim().max(200),
  concept: z.string().trim().max(300),
  amount_cents: z.number().int().positive(),
  currency: z.string().trim().length(3),
  issued_date: z.string(),
  due_date: z.string(),
  reference: z.string().trim().max(80),
  notes: z.string().trim().max(2000),
  payment_link: z.string().trim().max(500),
  payment_terms: z.string().trim().max(2000),
  status: z.enum(STORED_STATUSES),
}).partial().strict();

export function updateReceivable(id, patch) {
  const current = getReceivable(id) || fail("No existe esa factura.", 404);
  const data = receivablePatch.parse(patch || {});
  if (!Object.keys(data).length) fail("No hay nada que cambiar.");
  const next = { ...current, ...data };
  if (data.issued_date) next.issued_date = day(data.issued_date, "issued_date");
  if (data.due_date) next.due_date = day(data.due_date, "due_date");
  if (next.due_date < next.issued_date) fail("El vencimiento no puede ser anterior a la fecha de emisión.");
  if (data.currency) next.currency = data.currency.toUpperCase();
  db().prepare(
    `UPDATE receivables SET client = ?, email = ?, concept = ?, amount_cents = ?, currency = ?, issued_date = ?, due_date = ?,
       status = ?, reference = ?, notes = ?, payment_link = ?, payment_terms = ?, updated_at = ? WHERE id = ?`,
  ).run(next.client, next.email, next.concept, next.amount_cents, next.currency, next.issued_date, next.due_date, next.status,
    next.reference, next.notes, next.payment_link, next.payment_terms, now(), current.id);
  return getReceivable(current.id);
}

/** Pause or resume the chase. A paused invoice is never checked and never reminded. */
export function pauseReceivable(id, paused = true) {
  const current = getReceivable(id) || fail("No existe esa factura.", 404);
  if (current.status === "paid") fail("Esa factura ya está cobrada.", 409);
  db().prepare("UPDATE receivables SET status = ?, updated_at = ? WHERE id = ?").run(paused ? "paused" : "pending", now(), current.id);
  return getReceivable(current.id);
}

/**
 * Mark an invoice as collected. Pending reminders are discarded: a paid invoice
 * is never chased. The entry that paid it is kept as a reference, not modified.
 */
export function markPaid(id, { date = null, entry_id = null } = {}) {
  const current = getReceivable(id) || fail("No existe esa factura.", 404);
  if (current.status === "paid") fail("Esa factura ya está marcada como cobrada.", 409);
  const paid = date ? day(date, "date") : todayLocal();
  transaction(() => {
    db().prepare("UPDATE receivables SET status = 'paid', paid_date = ?, paid_entry_id = ?, updated_at = ? WHERE id = ?")
      .run(paid, entry_id || null, now(), current.id);
    db().prepare("UPDATE receivable_notices SET state = 'discarded' WHERE receivable_id = ? AND state = 'draft'").run(current.id);
    db().prepare("UPDATE receivable_proposals SET state = 'accepted' WHERE receivable_id = ? AND state = 'pending'").run(current.id);
  });
  return getReceivable(current.id);
}

export function deleteReceivable(id) {
  const current = getReceivable(id) || fail("No existe esa factura.", 404);
  db().prepare("DELETE FROM receivables WHERE id = ?").run(current.id);
  return { ok: true, deleted: current.id };
}

// ---------------------------------------------------------------- templates
const TONE = {
  sobrio: { hello: (c) => `Hola ${c}:`, bye: "Gracias," },
  cercano: { hello: (c) => `Hola ${c},`, bye: "Un saludo," },
  formal: { hello: (c) => `Estimado/a ${c}:`, bye: "Atentamente," },
};

const payHint = (r) => {
  if (r.payment_link) return `puedes pagarla aquí: ${r.payment_link}`;
  if (r.payment_terms) return `así puedes pagarla: ${r.payment_terms}`;
  return "dime cuándo la vas a pagar y lo anoto";
};

const sign = (settings) => (settings.signature ? `\n${settings.signature}` : "");

/** The sober Spanish text of a step, before any model rewrites it. */
export function templateFor(r, step, days, settings = receivableSettings()) {
  const tone = TONE[settings.tone] || TONE.sobrio;
  const amount = money(r.amount_cents, r.currency);
  const ref = r.reference || r.id.slice(0, 8);
  const concept = r.concept ? ` (${r.concept})` : "";
  if (step === 0) {
    return {
      subject: `Pago recibido · factura ${ref}`,
      body: `${tone.hello(r.client)}\n\nHe recibido el pago de ${amount} de la factura ${ref}${concept}. La doy por cobrada.\n\n${tone.bye}${sign(settings)}`,
    };
  }
  if (step === 1) {
    return {
      subject: `Factura ${ref} · vencimiento del ${r.due_date}`,
      body: `${tone.hello(r.client)}\n\nTe escribo por la factura ${ref}${concept}, de ${amount}, que venció el ${r.due_date}. `
        + `Han pasado ${days} ${days === 1 ? "día" : "días"} y no consta el pago.\n\n`
        + `Si ya la has pagado, ignora este mensaje. Si no, ${payHint(r)}.\n\n${tone.bye}${sign(settings)}`,
    };
  }
  return {
    subject: `Factura ${ref} pendiente · ${amount}`,
    body: `${tone.hello(r.client)}\n\nLa factura ${ref}${concept}, de ${amount}, venció el ${r.due_date} y sigue sin pagarse. `
      + `Hoy hace ${days} días.\n\nReferencia: ${ref}\nImporte: ${amount}\nVencimiento: ${r.due_date}\n\n`
      + `Cómo pagar: ${r.payment_terms || r.payment_link || "te paso los datos de pago si me los pides"}.\n\n`
      + `Si el pago ya está hecho, dime la fecha y la referencia para cuadrarlo.\n\n${tone.bye}${sign(settings)}`,
  };
}

// The model only rewrites the text: the facts it must keep are checked after.
let writer = null;
/** Tests (and a future local model) replace the drafting call. */
export const setDraftWriter = (fn) => { writer = fn; };

const MODEL_PROMPT = `Reescribe este aviso de cobro en castellano, sobrio y directo, sin frases hechas ni disculpas.
Conserva exactamente el importe, la referencia, las fechas y los datos de pago que aparecen. No añadas datos nuevos.
Devuelve solo el texto del correo, sin asunto y sin comentarios.`;

async function modelDraft({ receivable, step, days, template }) {
  const answer = await chat({
    messages: [
      { role: "system", content: MODEL_PROMPT },
      { role: "user", content: `Paso ${step}, ${days} días de retraso.\n\n${template.body}` },
    ],
    effort: "low", maxTokens: 700, temperature: 0.3, timeoutMs: 20000,
  });
  if (!answer?.ok || !String(answer.text || "").trim()) return null;
  return String(answer.text).trim().slice(0, 4000);
}

/** A draft for one step: the model's rewrite when it keeps the facts, else the template. */
async function draftFor(r, step, days, settings) {
  const template = templateFor(r, step, days, settings);
  if (!settings.use_model) return { ...template, source: "plantilla" };
  let body = null;
  try {
    body = writer ? await writer({ receivable: r, step, days, template, settings }) : await modelDraft({ receivable: r, step, days, template });
  } catch { body = null; }
  if (!body) return { ...template, source: "plantilla" };
  const amount = money(r.amount_cents, r.currency);
  const ref = r.reference || r.id.slice(0, 8);
  const keepsFacts = body.includes(amount) && (!r.reference || body.includes(ref));
  if (!keepsFacts) return { ...template, source: "plantilla" };
  return { subject: template.subject, body, source: "modelo" };
}

// ---------------------------------------------------------------- the ladder
const hasNotice = (receivableId, step) => !!db().prepare("SELECT 1 FROM receivable_notices WHERE receivable_id = ? AND step = ?").get(receivableId, step);

function insertNotice({ receivable_id, step, channel, subject, body, state, sent_at = null, error = "" }) {
  const id = uid();
  const ts = now();
  const res = db().prepare(
    `INSERT OR IGNORE INTO receivable_notices (id, receivable_id, ts, step, channel, subject, body, state, sent_at, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, receivable_id, ts, step, channel, subject, body, state, sent_at, error, ts);
  return res.changes ? getNotice(id) : null;
}

/** The client's whole file for the escalation: invoices, notices and days late. */
export function clientHistory(client, { today = todayLocal() } = {}) {
  const rows = db().prepare("SELECT * FROM receivables WHERE client = ? COLLATE NOCASE ORDER BY due_date").all(String(client || ""));
  return rows.map((r) => {
    const notices = db().prepare("SELECT step, state, ts, sent_at FROM receivable_notices WHERE receivable_id = ? ORDER BY step").all(r.id);
    return {
      id: r.id, reference: r.reference, concept: r.concept, amount_cents: r.amount_cents, amount: money(r.amount_cents, r.currency),
      issued_date: r.issued_date, due_date: r.due_date, status: r.status, days_overdue: Math.max(0, daysBetween(r.due_date, today) ?? 0),
      notices: notices.map((n) => ({ step: n.step, label: STEP_LABEL[n.step] || `Paso ${n.step}`, state: n.state, ts: n.ts, sent_at: n.sent_at })),
    };
  });
}

const historyText = (history) => history.map((h) => {
  const notices = h.notices.length ? h.notices.map((n) => `${n.label} (${n.state === "sent" ? "enviado" : n.state === "draft" ? "borrador" : "descartado"})`).join(", ") : "sin avisos";
  return `${h.reference || h.id.slice(0, 8)} · ${h.amount} · vence ${h.due_date} · ${h.status === "paid" ? "cobrada" : `${h.days_overdue} días de retraso`} · ${notices}`;
}).join("\n");

/**
 * One pass of the ladder over every pending invoice. Returns what it prepared.
 * `drafts: false` only escalates (the scheduled run when auto_draft is off).
 */
export async function checkReceivables({ today = todayLocal(), settings = receivableSettings(), drafts = true } = {}) {
  const created = [];
  const escalated = [];
  const rows = db().prepare("SELECT * FROM receivables WHERE status = 'pending' ORDER BY due_date").all();
  for (const r of rows) {
    const days = daysBetween(r.due_date, today);
    if (days === null || days < settings.step1_days) continue;
    const step = days >= settings.escalate_days ? 3 : days >= settings.step2_days ? 2 : 1;
    if (hasNotice(r.id, step)) continue;
    if (step === 3) {
      const before = clientHistory(r.client, { today });
      const notice = insertNotice({
        receivable_id: r.id, step: 3, channel: "internal", state: "sent", sent_at: now(),
        subject: `${r.client}: ${days} días de retraso`, body: historyText(before),
      });
      if (!notice) continue;
      // the notification carries the whole file, this escalation included
      const history = clientHistory(r.client, { today });
      await notify({
        kind: "receivables.escalated", severity: "high",
        title: `Cobro: ${r.client}, ${days} días de retraso`,
        body: `${money(r.amount_cents, r.currency)} · ${r.reference || r.id.slice(0, 8)} · ${days} días de retraso. ${history.length} ${history.length === 1 ? "factura" : "facturas"} en su historial. Decide qué hacer.`,
        dedupe_key: `receivables:escalate:${r.id}`, event: "ledger.receivables.escalated",
        payload: { receivable_id: r.id, client: r.client, days, amount_cents: r.amount_cents, history },
        url: appLink("#/cobros"),
      });
      escalated.push({ receivable_id: r.id, client: r.client, days, history });
      continue;
    }
    if (!drafts) continue;
    const draft = await draftFor(r, step, days, settings);
    const notice = insertNotice({ receivable_id: r.id, step, channel: "email", subject: draft.subject, body: draft.body, state: "draft" });
    if (!notice) continue;
    created.push({ notice: presentNotice(notice), receivable: present(r, { today }), source: draft.source });
  }
  return { ok: true, today, checked: rows.length, drafts: created, escalated };
}

// ---------------------------------------------------------------- notices
export function listDrafts() {
  const rows = db().prepare(
    `SELECT n.*, r.client, r.email, r.amount_cents, r.currency, r.reference, r.due_date FROM receivable_notices n
     JOIN receivables r ON r.id = n.receivable_id WHERE n.state = 'draft' ORDER BY n.ts DESC`,
  ).all();
  return rows.map((n) => ({ ...presentNotice(n), amount: money(n.amount_cents, n.currency) }));
}

export function updateNotice(id, patch) {
  const notice = getNotice(id) || fail("No existe ese aviso.", 404);
  if (notice.state === "sent") fail("Ese aviso ya se envió: no se puede cambiar.", 409);
  const data = z.object({ subject: z.string().trim().max(300).optional(), body: z.string().trim().min(1).max(8000).optional() }).strict().parse(patch || {});
  if (!Object.keys(data).length) fail("No hay nada que cambiar.");
  db().prepare("UPDATE receivable_notices SET subject = ?, body = ? WHERE id = ?")
    .run(data.subject ?? notice.subject, data.body ?? notice.body, notice.id);
  return presentNotice(getNotice(notice.id));
}

export function discardNotice(id) {
  const notice = getNotice(id) || fail("No existe ese aviso.", 404);
  if (notice.state === "sent") fail("Ese aviso ya se envió.", 409);
  db().prepare("UPDATE receivable_notices SET state = 'discarded' WHERE id = ?").run(notice.id);
  return presentNotice(getNotice(notice.id));
}

/**
 * Send one draft through the family's mail helper (the same one that reads the
 * mail). When it cannot send, the text comes back ready to copy and the notice
 * stays a draft with the reason.
 */
export async function sendNotice(id, { source = mailSource(), settings = receivableSettings() } = {}) {
  const notice = getNotice(id) || fail("No existe ese aviso.", 404);
  if (notice.state === "sent") fail("Ese aviso ya se envió.", 409);
  const r = getReceivable(notice.receivable_id) || fail("La factura de ese aviso ya no existe.", 404);
  if (!r.email) fail("La factura no tiene el correo del cliente: añádelo antes de enviar.", 400);
  const copy = { to: r.email, subject: notice.subject, body: notice.body };
  let answer;
  try {
    answer = await source.call("send", {
      to: [r.email], subject: notice.subject, text: notice.body,
      ...(settings.signature ? { from_name: settings.signature } : {}),
    });
  } catch (error) {
    answer = { ok: false, error: String(error?.message || error).slice(0, 200) };
  }
  if (!answer?.ok) {
    const reason = String(answer?.error || "el correo no ha salido").slice(0, 200);
    db().prepare("UPDATE receivable_notices SET error = ? WHERE id = ?").run(reason, notice.id);
    return { sent: false, error: reason, copy, notice: presentNotice(getNotice(notice.id)) };
  }
  db().prepare("UPDATE receivable_notices SET state = 'sent', sent_at = ?, error = '' WHERE id = ?").run(now(), notice.id);
  return { sent: true, copy, notice: presentNotice(getNotice(notice.id)) };
}

// ---------------------------------------------------------------- reconciliation
/**
 * A payment in the ledger that looks like a pending invoice: same amount and
 * the client's name or the invoice reference in the counterparty or the note.
 * It is only proposed; nothing is marked paid until the user says so.
 */
export function proposeForEntry(entry, { today = todayLocal() } = {}) {
  if (!entry || !(entry.amount_cents > 0)) return [];
  const rows = db().prepare("SELECT * FROM receivables WHERE status = 'pending'").all();
  const hay = fold(`${entry.counterparty || ""} ${entry.note || ""}`);
  const made = [];
  for (const r of rows) {
    if (r.amount_cents !== entry.amount_cents) continue;
    const issued = daysBetween(r.issued_date, entry.date);
    if (issued === null || issued < -5) continue;                       // paid before it was issued
    const ref = fold(r.reference);
    const byRef = ref.length >= 3 && hay.includes(ref);
    const byClient = merchantMatches(r.client, entry.counterparty || "") || (!!r.client && hay.includes(fold(r.client)));
    if (!byRef && !byClient) continue;
    const reason = byRef ? "la referencia coincide" : "el remitente coincide";
    const id = uid();
    const res = db().prepare(
      "INSERT OR IGNORE INTO receivable_proposals (id, receivable_id, entry_id, reason, state, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
    ).run(id, r.id, entry.id, reason, now());
    if (res.changes) made.push({ id, receivable_id: r.id, entry_id: entry.id, reason, client: r.client, amount: money(r.amount_cents, r.currency) });
  }
  return made;
}

/** Income entries of the last days that no proposal has looked at yet. */
export function sweepPayments({ days = 45, today = todayLocal() } = {}) {
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
  const rows = db().prepare(
    `SELECT e.* FROM entries e WHERE e.amount_cents > 0 AND e.date >= ? AND e.transfer_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM receivable_proposals p WHERE p.entry_id = e.id) ORDER BY e.date`,
  ).all(from);
  return rows.flatMap((e) => proposeForEntry(e, { today }));
}

export function listProposals() {
  return db().prepare(
    `SELECT p.*, r.client, r.reference, r.amount_cents AS receivable_cents, r.currency, e.date AS entry_date, e.counterparty, e.note
     FROM receivable_proposals p JOIN receivables r ON r.id = p.receivable_id JOIN entries e ON e.id = p.entry_id
     WHERE p.state = 'pending' ORDER BY p.created_at DESC`,
  ).all().map((p) => ({ ...p, amount: money(p.receivable_cents, p.currency) }));
}

/**
 * The user accepts a found payment: the invoice is marked paid on the entry's
 * date and a short thank-you note is left as a draft.
 */
export async function acceptProposal(id, { settings = receivableSettings() } = {}) {
  const p = db().prepare("SELECT * FROM receivable_proposals WHERE id = ?").get(String(id || "")) || fail("No existe esa propuesta.", 404);
  if (p.state !== "pending") fail("Esa propuesta ya está resuelta.", 409);
  const r = getReceivable(p.receivable_id) || fail("La factura de esa propuesta ya no existe.", 404);
  const entry = db().prepare("SELECT * FROM entries WHERE id = ?").get(p.entry_id);
  if (!entry) fail("El movimiento de esa propuesta ya no existe.", 409);
  markPaid(r.id, { date: entry.date, entry_id: entry.id });
  const draft = templateFor(getReceivable(r.id), 0, 0, settings);
  const notice = insertNotice({ receivable_id: r.id, step: 0, channel: "email", subject: draft.subject, body: draft.body, state: "draft" });
  return { receivable: present(getReceivable(r.id)), notice: presentNotice(notice), entry_id: entry.id };
}

export function dismissProposal(id) {
  const p = db().prepare("SELECT * FROM receivable_proposals WHERE id = ?").get(String(id || "")) || fail("No existe esa propuesta.", 404);
  if (p.state !== "pending") fail("Esa propuesta ya está resuelta.", 409);
  db().prepare("UPDATE receivable_proposals SET state = 'dismissed' WHERE id = ?").run(p.id);
  return { ok: true, id: p.id };
}

/** Tell the user about the payments that look like an invoice (once per proposal). */
export async function announceProposals(made) {
  for (const p of made) {
    await notify({
      kind: "receivables.payment_found", severity: "low",
      title: `Posible cobro de ${p.client}`,
      body: `${p.amount} · ${p.reason}. Confírmalo en Cobros.`,
      dedupe_key: `receivables:proposal:${p.id}`, event: "ledger.receivables.payment_found",
      payload: { proposal_id: p.id, receivable_id: p.receivable_id, entry_id: p.entry_id },
      url: appLink("#/cobros"),
    });
  }
  return made.length;
}

/** The daily job: the ladder plus a look at the income already in the ledger. */
export async function dailyCheck({ today = todayLocal(), settings = receivableSettings() } = {}) {
  const found = sweepPayments({ today });
  const run = await checkReceivables({ today, settings, drafts: settings.auto_draft });
  await announceProposals(found);
  return { ...run, proposals: found.length };
}

/** Amount text ("1.234,56") to positive cents, for the API and the tools. */
export function amountToCents(value) {
  const cents = parseAmount(value);
  if (cents === null || cents === 0) fail(`Importe no reconocido: "${value}".`);
  return Math.abs(cents);
}