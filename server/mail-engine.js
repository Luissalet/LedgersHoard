// Payments and subscriptions from mail: scan, parse, record as entries or
// queue for review, dedupe against every other source, undo.
//
// Mail text is untrusted data. It is parsed with fixed patterns; nothing in a
// message is ever executed or followed as an instruction, and only the parsed
// facts plus a short snippet are stored.
import crypto from "node:crypto";
import { db, now, uid, transaction } from "./db.js";
import { today as todayLocal, parseDate, monthRange, isMonth, thisMonth, daysBetween } from "./dates.js";
import { formatCents, parseAmount } from "./money.js";
import * as accountsApi from "./accounts.js";
import * as categoriesApi from "./categories.js";
import { createEntry, getEntry, deleteEntry } from "./entries.js";
import { parseMail, oneLine, normText } from "./mail-parse.js";
import { CATEGORY_HINTS, SHOP_CATS, fold } from "./mail-merchants.js";
import { merchantMatches, findMatchingEntry, merchantKey } from "./mail-match.js";
import { mailSettings } from "./mail-settings.js";
import { mailSource } from "./mail-source.js";
import { runtime } from "./mail-runtime.js";
import { beginBatch, flushBatch, notify, setHistory, HISTORY_AFTER_MS } from "./notifications.js";
import * as subs from "./subscriptions.js";

export const PAYMENT_GMAIL_QUERY = '(recibo OR factura OR "has pagado" OR "pago realizado" OR "pago recibido" OR cargo OR "se ha cargado" OR "compra realizada" OR "tu pedido" OR "total del pedido" OR suscripción OR renovación OR membresía OR "próximo cobro" OR "prueba gratuita" OR reembolso OR receipt OR invoice OR "your payment" OR "payment received" OR "payment confirmation" OR subscription OR renewal OR "your order" OR refund OR "trial ends") -category:promotions -category:social -category:forums';
export const PAYMENT_SUBJECT_TERMS = [
  "recibo", "factura", "pago", "cargo", "compra", "pedido", "suscripción", "suscripcion", "renovación", "renovacion", "membresía", "membresia",
  "reembolso", "prueba gratuita", "receipt", "invoice", "payment", "subscription", "renewal", "order", "refund", "trial", "charged",
];

const MAX_RUNS = 50;
const fail = (message, status = 400, extra = {}) => { throw Object.assign(new Error(message), { status, ...extra }); };
const money = (cents, currency = "EUR") => formatCents(cents, currency === "EUR" ? "€" : currency);

// ---------------------------------------------------------------- rows
const mailRow = (r) => (r ? { ...r, facts: JSON.parse(r.facts || "{}") } : null);
export const getMail = (id) => mailRow(db().prepare("SELECT * FROM mail_messages WHERE message_id = ?").get(id));
const hasMail = (id) => !!db().prepare("SELECT 1 FROM mail_messages WHERE message_id = ?").get(id);

function insertMail({ message_id, ts, sender, subject, kind, state, facts, entry_id = null, snippet }) {
  db().prepare(
    "INSERT INTO mail_messages (message_id, ts, sender, subject, kind, state, facts, entry_id, snippet, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(message_id, ts, sender, subject, kind, state, JSON.stringify(facts), entry_id, snippet, now());
}
function updateMail(id, patch) {
  const current = getMail(id);
  const next = { ...current, ...patch };
  db().prepare("UPDATE mail_messages SET kind = ?, state = ?, facts = ?, entry_id = ? WHERE message_id = ?")
    .run(next.kind, next.state, JSON.stringify(next.facts), next.entry_id ?? null, id);
  return getMail(id);
}

/** Mails whose entry was deleted elsewhere stop counting as recorded. */
function reconcileDeleted() {
  db().prepare(
    "UPDATE mail_messages SET state = 'ignored' WHERE state = 'recorded' AND entry_id IS NOT NULL AND entry_id NOT IN (SELECT id FROM entries)",
  ).run();
}

export function presentMail(r) {
  if (!r) return null;
  const f = r.facts || {};
  const entry = r.entry_id ? getEntry(r.entry_id) : null;
  return {
    message_id: r.message_id, ts: r.ts, from: r.sender, subject: r.subject, snippet: r.snippet, kind: r.kind, state: r.state,
    merchant: f.merchant ?? null, amount_cents: f.amount_cents ?? null, currency: f.currency ?? null,
    amount: f.amount_cents != null ? money(f.amount_cents, f.currency || "EUR") : null,
    date: f.charge_date ?? null, period: f.period ?? "unknown", subscription: !!f.subscription,
    confidence: f.confidence ?? 0, reasons: f.reasons || [], review_reasons: f.review_reasons || [],
    order_ref: f.order_ref ?? null, next_charge_date: f.next_charge_date ?? null,
    entry_id: r.entry_id, entry: entry ? { id: entry.id, date: entry.date, amount_cents: entry.amount_cents, amount: money(entry.amount_cents), account: entry.account_name, category: entry.category_name, counterparty: entry.counterparty, source: entry.source } : null,
    duplicate_of: f.duplicate_of ?? null, duplicate_of_mail: f.duplicate_of_mail ?? null, matched_bank: !!f.matched_bank,
    order_cancel: !!f.order_cancel, cancels_message_id: f.cancels_message_id ?? null,
  };
}

// ---------------------------------------------------------------- choices
/** Account for mail charges: the setting, else the only active account, else a reason. */
export function resolveMailAccount(settings = mailSettings()) {
  if (settings.account) {
    const account = accountsApi.getAccount(settings.account);
    if (account && !account.archived) return { account };
  }
  const active = accountsApi.listAccounts({ includeArchived: false });
  if (active.length === 1) return { account: active[0] };
  if (!active.length) return { account: null, reason: "no hay cuentas" };
  return { account: null, reason: "elige la cuenta para los cargos del correo", candidates: active.map((a) => a.name) };
}

/** Category: most used before for that counterparty, else the merchant hint by name, else none. Never creates one. */
export function guessCategory(merchant, hint) {
  const categories = categoriesApi.listCategories({ includeArchived: false }).filter((c) => c.kind === "expense");
  const usable = new Set(categories.map((c) => c.id));
  const rows = db().prepare(
    "SELECT category_id, counterparty FROM entries WHERE category_id IS NOT NULL AND counterparty <> '' AND transfer_id IS NULL ORDER BY date DESC, created_at DESC LIMIT 1500",
  ).all();
  const counts = new Map();
  for (const r of rows) {
    if (!usable.has(r.category_id) || !merchantMatches(merchant, r.counterparty)) continue;
    counts.set(r.category_id, (counts.get(r.category_id) || 0) + 1);
  }
  if (counts.size) {
    const best = Math.max(...counts.values());
    const winner = [...counts.entries()].find(([, n]) => n === best)[0]; // first in recency order
    return { category_id: winner, how: "historial" };
  }
  for (const name of CATEGORY_HINTS[hint] || []) {
    const hit = categories.find((c) => fold(c.name).trim() === fold(name).trim());
    if (hit) return { category_id: hit.id, how: `pista «${hint}»` };
  }
  return { category_id: null, how: "sin categoría" };
}

const entryNote = (subject) => `«${oneLine(subject, 160)}» · correo`;

function recordEntry({ message_id, facts, subject, account_id, category_id, amount_cents, date, merchant, kind }) {
  const refund = kind === "refund";
  return createEntry({
    date, amount_cents: refund ? Math.abs(amount_cents) : -Math.abs(amount_cents), account_id, category_id,
    counterparty: merchant, note: entryNote(subject), tags: ["correo"], source: "mail", source_ref: `mail:${message_id}`,
  });
}

const slug = (text) => fold(text).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

async function followSubscription({ facts, merchant, amount_cents, currency, date, account_id, category_id }) {
  try {
    // platforms bill several services (Google Play): each product is its own subscription
    const product = facts.product || null;
    const base = facts.merchant_key || merchantKey(merchant);
    await subs.observeCharge({
      merchant, amount_cents, currency, date, period: facts.period || "unknown", next_date: facts.next_charge_date || null,
      hint: !!facts.subscription, account_id, category_id,
      ...(product ? { key: `${base}:${slug(product)}`, name: `${merchant} · ${product}` } : {}),
      recurring: !SHOP_CATS.has(facts.category_hint),
    });
  } catch { /* a subscription problem never blocks the entry */ }
}

// ---------------------------------------------------------------- processing
const syntheticId = (raw) => `nomid:${crypto.createHash("sha1").update(`${raw.from_address}|${raw.subject}|${raw.ts}|${String(raw.text || "").slice(0, 200)}`).digest("hex")}`;
const senderOf = (raw) => oneLine(raw.from_name ? `${raw.from_name} <${raw.from_address || ""}>` : raw.from_address || "", 300);
const tsOf = (raw, nowMs) => new Date(Number(raw.ts) > 0 ? Number(raw.ts) * 1000 : nowMs).toISOString();

/**
 * Process one message. Returns { skipped } for a message already seen, else
 * { state, kind, entry?, reasons, message_id }.
 */
export async function processMessage(raw, { settings = mailSettings(), nowMs = Date.now(), manual = false } = {}) {
  const message_id = String(raw.message_id || "").trim().slice(0, 300) || syntheticId(raw);
  if (hasMail(message_id)) return { skipped: true, message_id };
  const facts = parseMail(raw, { now: nowMs });
  const base = { message_id, ts: tsOf(raw, nowMs), sender: senderOf(raw), subject: oneLine(raw.subject, 300), snippet: oneLine(normText(raw.text), 300) };
  const alertDate = facts.mail_date;

  if (facts.kind === "noise") {
    insertMail({ ...base, kind: "noise", state: "ignored", facts });
    return { state: "ignored", kind: "noise", message_id, reasons: facts.reasons };
  }
  if (facts.kind === "failed") {
    insertMail({ ...base, kind: "failed", state: "ignored", facts: { ...facts, handled: "alert" } });
    await subs.observeFailed({ merchant: facts.merchant, amount_cents: facts.amount_cents, currency: facts.currency || "EUR", message_id });
    return { state: "ignored", kind: "failed", message_id, reasons: facts.reasons };
  }
  if (facts.kind === "cancel" && facts.order_cancel) return handleOrderCancel(base, facts);
  if (facts.kind === "cancel") {
    insertMail({ ...base, kind: "cancel", state: "ignored", facts: { ...facts, handled: "subscription" } });
    await subs.observeCancel({ merchant: facts.merchant, message_id, date: alertDate });
    return { state: "ignored", kind: "cancel", message_id, reasons: facts.reasons };
  }
  if (facts.kind === "upcoming") {
    insertMail({ ...base, kind: "upcoming", state: "ignored", facts: { ...facts, handled: "subscription" } });
    if (SHOP_CATS.has(facts.category_hint) && !facts.subscription) return { state: "ignored", kind: "upcoming", message_id, reasons: facts.reasons };
    await subs.observeUpcoming({
      merchant: facts.merchant, amount_cents: facts.amount_cents, currency: facts.currency || "EUR", period: facts.period,
      next_date: facts.next_charge_date, trial_end: facts.trial_end_date, price_change: facts.price_change, today: todayLocal(),
    });
    return { state: "ignored", kind: "upcoming", message_id, reasons: facts.reasons };
  }
  return recordOrReview(base, facts, settings, { manual });
}

const WEAK_REF_LENGTH = 7;
const STATE_RANK = { recorded: 0, review: 1, duplicate: 2, ignored: 3 };

/**
 * An earlier mail about the same order: same merchant and order reference.
 * Short references (restaurant order numbers) repeat from day to day, so they
 * only count when the charge dates are one day apart at most.
 */
function findOrderMail(facts, message_id, kinds = [facts.kind]) {
  if (!facts.order_ref || !facts.merchant_key) return null;
  const marks = kinds.map(() => "?").join(", ");
  const rows = db().prepare(
    `SELECT * FROM mail_messages
     WHERE message_id <> ? AND kind IN (${marks}) AND state IN ('recorded', 'duplicate', 'review', 'ignored')
       AND json_extract(facts, '$.order_ref') = ? AND json_extract(facts, '$.merchant_key') = ?
     ORDER BY created_at`,
  ).all(message_id, ...kinds, facts.order_ref, facts.merchant_key).map(mailRow);
  const weak = facts.order_ref.length < WEAK_REF_LENGTH;
  const close = (r) => !weak || (r.facts.charge_date && facts.charge_date && Math.abs(daysBetween(r.facts.charge_date, facts.charge_date)) <= 1);
  const hits = rows.filter(close).sort((a, b) => (STATE_RANK[a.state] ?? 9) - (STATE_RANK[b.state] ?? 9));
  return hits[0] || null;
}

/** A cancellation mail already seen for this order. */
function cancelledOrder(facts) {
  if (!facts.order_ref || !facts.merchant_key) return false;
  return !!db().prepare(
    "SELECT 1 FROM mail_messages WHERE kind = 'cancel' AND json_extract(facts, '$.order_cancel') = 1 AND json_extract(facts, '$.order_ref') = ? AND json_extract(facts, '$.merchant_key') = ? LIMIT 1",
  ).get(facts.order_ref, facts.merchant_key);
}

/** Why a charge cannot be recorded by itself (empty array: it can). */
function reviewReasonsFor(facts, settings) {
  const reasons = [];
  const complete = facts.merchant && facts.amount_cents != null && facts.charge_date;
  if (!settings.auto_record) reasons.push("el apunte automático está desactivado");
  if (!complete) {
    if (!facts.merchant) reasons.push("falta el comercio");
    if (facts.amount_cents == null) reasons.push("falta el importe");
    if (!facts.charge_date) reasons.push("falta la fecha");
  }
  if (facts.confidence < settings.min_confidence) reasons.push(`confianza ${facts.confidence} por debajo del mínimo ${settings.min_confidence}`);
  if (settings.review_above > 0 && facts.amount_cents != null && facts.amount_cents > settings.review_above * 100) reasons.push("importe alto (revísalo)");
  if (cancelledOrder(facts)) reasons.push("pedido cancelado");
  const chosen = resolveMailAccount(settings);
  if (!chosen.account) reasons.push(chosen.reason);
  else if (facts.currency && facts.currency !== chosen.account.currency) reasons.push(`divisa ${facts.currency} distinta de la cuenta (${chosen.account.currency})`);
  if (facts.conflict) reasons.push("hay importes distintos con el mismo peso");
  return { reasons, chosen };
}

/** Create the entry for a mail and mark it recorded (insert the row, or update an existing review row). */
async function recordNow({ base, facts, chosen, existing = false }) {
  const { message_id } = base;
  const kind = facts.kind;
  const category = guessCategory(facts.merchant, facts.category_hint);
  let entry;
  transaction(() => {
    entry = recordEntry({
      message_id, facts, subject: base.subject, account_id: chosen.account.id, category_id: category.category_id,
      amount_cents: facts.amount_cents, date: facts.charge_date, merchant: facts.merchant, kind,
    });
    const final = { ...facts, category_how: category.how, review_reasons: [] };
    if (existing) updateMail(message_id, { kind, state: "recorded", facts: final, entry_id: entry.id });
    else insertMail({ ...base, kind, state: "recorded", facts: final, entry_id: entry.id });
  });
  if (kind === "charge") await followSubscription({ facts, merchant: facts.merchant, amount_cents: facts.amount_cents, currency: facts.currency || "EUR", date: facts.charge_date, account_id: chosen.account.id, category_id: category.category_id });
  await notify({
    kind: "mail.recorded", severity: "low",
    title: `${kind === "refund" ? "Reembolso" : "Pago"} apuntado: ${facts.merchant} ${money(facts.amount_cents, facts.currency || "EUR")}`,
    body: `${facts.charge_date} · ${chosen.account.name}${category.category_id ? ` · ${entry.category_name}` : ""}`,
    dedupe_key: `recorded:${message_id}`, event: "ledger.mail.recorded",
    payload: { entry_id: entry.id, merchant: facts.merchant, amount: entry.amount_cents, currency: facts.currency || "EUR", date: facts.charge_date, message_id },
  });
  return entry;
}

/** A later mail about an order we already know: it never records again; it may complete a review item. */
async function handleSameOrder(base, facts, prior, settings) {
  const { message_id } = base;
  const kind = facts.kind;
  let entry_id = prior.entry_id || null;
  if (prior.state === "review" && facts.amount_cents != null && (prior.facts.amount_cents == null || !prior.facts.charge_date)) {
    const merged = {
      ...prior.facts, merchant: prior.facts.merchant || facts.merchant, merchant_key: prior.facts.merchant_key || facts.merchant_key,
      amount_cents: facts.amount_cents, currency: facts.currency || prior.facts.currency, charge_date: prior.facts.charge_date || facts.charge_date,
      confidence: Math.max(prior.facts.confidence || 0, facts.confidence), amount_source: facts.amount_source, conflict: facts.conflict,
    };
    const { reasons, chosen } = reviewReasonsFor(merged, settings);
    if (!reasons.length) {
      const entry = await recordNow({ base: { message_id: prior.message_id, subject: prior.subject }, facts: { ...merged, kind: prior.kind }, chosen, existing: true });
      entry_id = entry.id;
    } else {
      updateMail(prior.message_id, { facts: { ...merged, review_reasons: reasons } });
    }
  }
  insertMail({
    ...base, kind, state: "duplicate", entry_id,
    facts: { ...facts, duplicate_of: entry_id, duplicate_of_mail: prior.message_id, duplicate_reason: "mismo pedido" },
  });
  if (kind === "charge" && prior.state === "recorded") {
    await followSubscription({ facts, merchant: facts.merchant, amount_cents: facts.amount_cents, currency: facts.currency || "EUR", date: facts.charge_date });
  }
  return { state: "duplicate", kind, message_id, entry_id, reasons: facts.reasons };
}

async function recordOrReview(base, facts, settings) {
  const { message_id } = base;
  const kind = facts.kind;
  const complete = facts.merchant && facts.amount_cents != null && facts.charge_date;
  const signed = kind === "refund" ? Math.abs(facts.amount_cents ?? 0) : -Math.abs(facts.amount_cents ?? 0);

  const sameOrder = findOrderMail(facts, message_id);
  if (sameOrder) return handleSameOrder(base, facts, sameOrder, settings);
  if (complete) {
    const match = findMatchingEntry({ amount_cents: signed, date: facts.charge_date, merchant: facts.merchant });
    if (match) {
      insertMail({ ...base, kind, state: "duplicate", facts: { ...facts, duplicate_of: match.id, duplicate_reason: "movimiento existente" }, entry_id: match.id });
      if (kind === "charge") await followSubscription({ facts, merchant: facts.merchant, amount_cents: facts.amount_cents, currency: facts.currency || "EUR", date: match.date || facts.charge_date });
      return { state: "duplicate", kind, message_id, entry_id: match.id, reasons: facts.reasons };
    }
  }

  const { reasons, chosen } = reviewReasonsFor(facts, settings);
  if (reasons.length) {
    insertMail({ ...base, kind, state: "review", facts: { ...facts, review_reasons: reasons } });
    return { state: "review", kind, message_id, reasons: facts.reasons, review_reasons: reasons };
  }
  const entry = await recordNow({ base, facts, chosen });
  return { state: "recorded", kind, message_id, entry, reasons: facts.reasons };
}

/**
 * «Tu pedido ha sido cancelado»: not a subscription. When we recorded that
 * order, the cancellation waits in review (the entry may be wrong); when the
 * order is in review, it gets a reason; otherwise there is nothing to do.
 */
async function handleOrderCancel(base, facts) {
  const { message_id } = base;
  const original = findOrderMail(facts, message_id, ["charge", "refund"]);
  if (original?.state === "recorded" && original.entry_id && getEntry(original.entry_id)) {
    const reasons = ["pedido cancelado: el movimiento apuntado puede no ser real; quítalo o ignora este aviso"];
    insertMail({ ...base, kind: "cancel", state: "review", entry_id: original.entry_id, facts: { ...facts, cancels_message_id: original.message_id, review_reasons: reasons } });
    await notify({
      kind: "mail.order_cancelled", severity: "medium", title: `Pedido cancelado: ${facts.merchant || original.facts.merchant}`,
      body: `Ya apuntado el ${original.facts.charge_date}: revisa si hay que quitar el movimiento.`,
      dedupe_key: `ordercancel:${message_id}`, event: "ledger.mail.order_cancelled",
      payload: { entry_id: original.entry_id, merchant: original.facts.merchant, message_id },
    });
    return { state: "review", kind: "cancel", message_id, reasons: facts.reasons, review_reasons: reasons };
  }
  if (original?.state === "review") {
    const reasons = [...new Set([...(original.facts.review_reasons || []), "pedido cancelado"])];
    updateMail(original.message_id, { facts: { ...original.facts, review_reasons: reasons } });
  }
  insertMail({ ...base, kind: "cancel", state: "ignored", facts: { ...facts, handled: "order" } });
  return { state: "ignored", kind: "cancel", message_id, reasons: facts.reasons };
}

// ---------------------------------------------------------------- actions
const amountOverride = (value) => {
  const cents = parseAmount(value);
  if (cents === null || cents === 0) fail(`Importe no reconocido: "${value}".`);
  return Math.abs(cents);
};

/** Record a mail from the review queue (or an ignored one), with optional overrides. */
export async function acceptMail(message_id, overrides = {}) {
  const r = getMail(message_id) || fail("No existe ese correo.", 404);
  if (r.state === "recorded") fail("Ese correo ya está apuntado.", 409);
  if (r.kind === "cancel") fail("Es el aviso de un pedido cancelado, no un cobro. Quita el movimiento con mail_undo sobre el pedido original, o ignora este aviso.", 409, { cancels_message_id: r.facts.cancels_message_id || null });
  if (r.state === "duplicate" && !overrides.force) fail("Está marcado como duplicado de un movimiento existente. Ignóralo, o repite con force: true si no es el mismo pago.", 409, { duplicate_of: r.facts.duplicate_of });
  const f = { ...r.facts };
  const merchant = overrides.merchant ? oneLine(overrides.merchant, 80) : f.merchant;
  const amount_cents = overrides.amount !== undefined && overrides.amount !== null ? amountOverride(overrides.amount) : f.amount_cents;
  const date = overrides.date ? parseDate(String(overrides.date)) || fail(`Fecha no válida: "${overrides.date}".`) : f.charge_date;
  const missing = [];
  if (!merchant) missing.push("el comercio (merchant)");
  if (amount_cents == null) missing.push("el importe (amount)");
  if (!date) missing.push("la fecha (date)");
  if (missing.length) fail(`Falta ${missing.join(", ")}.`, 400, { missing });

  let account;
  if (overrides.account) {
    const found = accountsApi.resolveAccountFuzzy(overrides.account);
    if (!found.account) fail(`Cuenta "${overrides.account}" no encontrada o ambigua.`, 400, { candidates: found.candidates });
    account = found.account;
  } else {
    const chosen = resolveMailAccount();
    if (!chosen.account) fail(`Indica la cuenta (${chosen.reason}).`, 400, { candidates: chosen.candidates || [] });
    account = chosen.account;
  }
  let category_id;
  if (overrides.category === null || overrides.category === "") category_id = null;
  else if (overrides.category) {
    const found = categoriesApi.resolveCategory(overrides.category);
    if (!found.category) fail(`Categoría "${overrides.category}" no encontrada o ambigua.`, 400, { candidates: found.candidates });
    category_id = found.category.id;
  } else category_id = guessCategory(merchant, f.category_hint).category_id;

  const kind = overrides.kind === "refund" ? "refund" : r.kind === "refund" ? "refund" : "charge";
  const signed = kind === "refund" ? Math.abs(amount_cents) : -Math.abs(amount_cents);
  const possible = findMatchingEntry({ amount_cents: signed, date, merchant });
  let entry;
  transaction(() => {
    entry = recordEntry({ message_id, facts: f, subject: r.subject, account_id: account.id, category_id, amount_cents, date, merchant, kind });
    updateMail(message_id, {
      kind, state: "recorded", entry_id: entry.id,
      facts: { ...f, merchant, amount_cents, charge_date: date, currency: f.currency || account.currency, accepted_by: "user", review_reasons: [] },
    });
  });
  if (kind === "charge") await followSubscription({ facts: f, merchant, amount_cents, currency: f.currency || account.currency, date, account_id: account.id, category_id });
  return { mail: presentMail(getMail(message_id)), entry, ...(possible ? { warning: `Existe un movimiento parecido (${possible.id}, ${possible.date}, ${money(possible.amount_cents)}). Revisa que no esté duplicado.`, similar_entry_id: possible.id } : {}) };
}

export function ignoreMail(message_id) {
  const r = getMail(message_id) || fail("No existe ese correo.", 404);
  if (r.state === "recorded") fail("Ese correo está apuntado: usa deshacer para quitar el movimiento.", 409);
  updateMail(message_id, { state: "ignored" });
  return presentMail(getMail(message_id));
}

/** Delete the entry this mail created and ignore the mail. Needs confirm: true. */
export function undoMail(message_id, { confirm } = {}) {
  const r = getMail(message_id) || fail("No existe ese correo.", 404);
  if (confirm !== true) fail("Deshacer borra el movimiento que creó este correo. Confirma con confirm: true.", 400);
  if (r.state !== "recorded") fail("Ese correo no ha creado ningún movimiento.", 409);
  const entry = r.entry_id ? getEntry(r.entry_id) : null;
  if (entry && entry.source !== "mail") fail("El movimiento ya está conciliado con un extracto del banco; bórralo desde Movimientos si es lo que quieres.", 409, { entry_id: entry.id });
  if (entry) deleteEntry(entry.id);
  updateMail(message_id, { state: "ignored", entry_id: null, facts: { ...r.facts, undone: true } });
  db().prepare("UPDATE mail_messages SET state = 'ignored' WHERE state = 'review' AND kind = 'cancel' AND json_extract(facts, '$.cancels_message_id') = ?").run(message_id);
  return { undone: true, deleted: entry ? { id: entry.id, date: entry.date, amount_cents: entry.amount_cents, amount: money(entry.amount_cents), counterparty: entry.counterparty } : null, mail: presentMail(getMail(message_id)) };
}

/**
 * Start over: forget every mail read, the subscriptions created from mail,
 * the notifications and the scan history. Entries stay unless
 * delete_entries is true, and then only those a mail created and no bank
 * row has adopted. Needs confirm: true.
 */
export function resetMail({ confirm, delete_entries = false } = {}) {
  if (confirm !== true) fail("Reiniciar el correo borra el registro de correos leídos, las suscripciones creadas desde el correo, los avisos y el historial de lecturas. Confirma con confirm: true.", 400);
  if (runtime.scanning) fail("Hay una lectura de correo en curso: espera a que acabe.", 409);
  const out = { entries_deleted: 0 };
  if (delete_entries) {
    const rows = db().prepare("SELECT id FROM entries WHERE source = 'mail' AND import_hash IS NULL AND source_ref LIKE 'mail:%'").all();
    for (const r of rows) { deleteEntry(r.id); out.entries_deleted++; }
  }
  transaction(() => {
    out.mail_messages = Number(db().prepare("DELETE FROM mail_messages").run().changes);
    out.subscriptions = Number(db().prepare("DELETE FROM subscriptions WHERE source = 'mail'").run().changes);
    out.notifications = Number(db().prepare("DELETE FROM notifications").run().changes);
    out.runs = Number(db().prepare("DELETE FROM mail_runs").run().changes);
  });
  return { reset: true, ...out, note: delete_entries ? "Los movimientos creados desde el correo se han borrado; el resto no se ha tocado." : "Los movimientos no se han tocado." };
}

const parseFrom = (text) => {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(String(text || ""));
  if (m) return { from_name: m[1].trim(), from_address: m[2].trim() };
  const t = String(text || "").trim();
  return t.includes("@") ? { from_name: "", from_address: t } : { from_name: t, from_address: "" };
};

/** A receipt that is not in the inbox: pasted subject, text and sender go through the same pipeline. */
export async function pasteMail({ subject = "", text, from = "", date = null }) {
  if (!String(text || "").trim()) fail("Pega el texto del correo.");
  const nowMs = Date.now();
  const when = date ? parseDate(String(date)) : null;
  const ts = when ? Date.parse(`${when}T12:00:00`) / 1000 : nowMs / 1000;
  const id = `paste:${crypto.createHash("sha1").update(`${subject}|${text}`).digest("hex").slice(0, 24)}`;
  const outcome = await processMessage({ message_id: id, subject, text, ...parseFrom(from), ts }, { nowMs });
  if (outcome.skipped) {
    const r = getMail(id);
    return { already: true, mail: presentMail(r) };
  }
  return { ...outcome, mail: presentMail(getMail(id)) };
}

// ---------------------------------------------------------------- reads
export function listMail({ state = null, kind = null, limit = 100 } = {}) {
  reconcileDeleted();
  const where = [];
  const params = [];
  if (state) { where.push("state = ?"); params.push(state); }
  if (kind) { where.push("kind = ?"); params.push(kind); }
  const rows = db().prepare(`SELECT * FROM mail_messages${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY ts DESC LIMIT ?`).all(...params, limit);
  return rows.map(mailRow).map(presentMail);
}

export function reviewQueue() {
  return listMail({ state: "review", limit: 200 });
}

/** Mails recorded as entries in a month (by entry date), newest first. */
export function recordedInMonth(month = thisMonth()) {
  if (!isMonth(month)) fail("Mes no válido (YYYY-MM).");
  reconcileDeleted();
  const { from, to } = monthRange(month);
  const rows = db().prepare(
    `SELECT m.* FROM mail_messages m JOIN entries e ON e.id = m.entry_id
     WHERE m.state = 'recorded' AND e.date >= ? AND e.date <= ? ORDER BY e.date DESC, m.ts DESC`,
  ).all(from, to);
  return rows.map(mailRow).map(presentMail);
}

/** What mail recorded in a month, by merchant and by category, with the entries behind each figure. */
export function mailSpending(month = thisMonth()) {
  if (!isMonth(month)) fail("Mes no válido (YYYY-MM).");
  const { from, to } = monthRange(month);
  const rows = db().prepare(
    `SELECT e.id, e.date, e.amount_cents, e.counterparty, e.category_id, c.name AS category_name, a.name AS account_name, e.source, e.source_ref
     FROM entries e JOIN accounts a ON a.id = e.account_id LEFT JOIN categories c ON c.id = e.category_id
     WHERE e.source_ref LIKE 'mail:%' AND e.date >= ? AND e.date <= ? AND e.transfer_id IS NULL ORDER BY e.date, e.created_at`,
  ).all(from, to);
  const merchants = new Map();
  const cats = new Map();
  let net = 0;
  for (const r of rows) {
    net += r.amount_cents;
    const m = merchants.get(r.counterparty) || { merchant: r.counterparty, spent_cents: 0, count: 0, entries: [] };
    m.spent_cents -= r.amount_cents;
    m.count++;
    m.entries.push({ entry_id: r.id, date: r.date, amount_cents: r.amount_cents, amount: money(r.amount_cents), account: r.account_name, category: r.category_name, bank_matched: r.source !== "mail", link: `#/movimientos?text=${encodeURIComponent(r.counterparty)}&from=${from}&to=${to}` });
    merchants.set(r.counterparty, m);
    const key = r.category_id || "none";
    const c = cats.get(key) || { category: r.category_name || "Sin categoría", category_id: r.category_id, spent_cents: 0, count: 0 };
    c.spent_cents -= r.amount_cents;
    c.count++;
    cats.set(key, c);
  }
  const fmt = (x) => ({ ...x, spent: money(x.spent_cents) });
  return {
    month, count: rows.length, spent_cents: -net, spent: money(-net),
    by_merchant: [...merchants.values()].sort((a, b) => b.spent_cents - a.spent_cents).map(fmt),
    by_category: [...cats.values()].sort((a, b) => b.spent_cents - a.spent_cents).map(fmt),
    note: "Importe neto: los reembolsos restan. Solo cuenta movimientos creados desde el correo (también los que ya concilió un extracto del banco).",
  };
}

// ---------------------------------------------------------------- runs and status
const runRow = (r) => (r ? { ...r, ok: !!r.ok } : null);
export function listRuns(limit = MAX_RUNS) {
  return db().prepare("SELECT * FROM mail_runs ORDER BY ts DESC, rowid DESC LIMIT ?").all(limit).map(runRow);
}
const lastOkRun = () => runRow(db().prepare("SELECT * FROM mail_runs WHERE ok = 1 ORDER BY ts DESC, rowid DESC LIMIT 1").get());

function writeRun(run) {
  db().prepare(
    `INSERT INTO mail_runs (id, ts, trigger, ok, error, since_days, scanned, recorded, review, duplicates, ignored, alerts, ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(uid(), now(), run.trigger, run.ok ? 1 : 0, run.error || "", run.since_days || 0, run.scanned || 0, run.recorded || 0, run.review || 0, run.duplicates || 0, run.ignored || 0, run.alerts || 0, run.ms || 0);
  db().prepare("DELETE FROM mail_runs WHERE id NOT IN (SELECT id FROM mail_runs ORDER BY ts DESC, rowid DESC LIMIT ?)").run(MAX_RUNS);
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * One scan: ask Faustus's mail for payment-looking messages, process them
 * oldest first. Only one scan runs at a time ({ busy: true } otherwise).
 */
export async function scanMail({ since_days = null, query = "", trigger = "manual", source = mailSource(), nowMs = Date.now() } = {}) {
  if (runtime.scanning) return { ok: false, busy: true, error: "Ya hay una lectura de correo en curso." };
  runtime.scanning = true;
  const started = Date.now();
  const run = { trigger, ok: true, error: "", since_days: 0, scanned: 0, recorded: 0, review: 0, duplicates: 0, ignored: 0, alerts: 0, ms: 0 };
  try {
    const settings = mailSettings();
    const last = lastOkRun();
    run.since_days = clamp(Number(since_days) || (last ? settings.window_days : settings.first_days), 1, 365);
    const skip = db().prepare("SELECT message_id FROM mail_messages ORDER BY created_at DESC LIMIT 5000").all().map((r) => r.message_id);
    const answer = await source.scan({
      since_days: run.since_days, limit: 300, skip, query: String(query || "").trim().slice(0, 200),
      gmail_query: PAYMENT_GMAIL_QUERY, subject_terms: PAYMENT_SUBJECT_TERMS,
    });
    if (!answer?.ok) {
      run.ok = false;
      run.error = String(answer?.error || "La lectura del correo ha fallado.").slice(0, 300);
    } else {
      if (answer.error) run.error = String(answer.error).slice(0, 300);
      const messages = [...(answer.messages || [])].sort((a, b) => (a.ts || 0) - (b.ts || 0));
      beginBatch();
      for (const raw of messages) {
        run.scanned++;
        try {
          // first read only: mail older than three days is history (stored, not announced)
          setHistory(settings.quiet_history && !last && raw.ts && nowMs - Number(raw.ts) * 1000 > HISTORY_AFTER_MS);
          const out = await processMessage(raw, { settings, nowMs });
          if (out.skipped) continue;
          if (out.state === "recorded") run.recorded++;
          else if (out.state === "review") run.review++;
          else if (out.state === "duplicate") run.duplicates++;
          else run.ignored++;
        } catch (error) {
          run.error = `${run.error ? `${run.error}; ` : ""}${String(error.message || error).slice(0, 120)}`.slice(0, 300);
        }
      }
      setHistory(false);
      run.alerts += await subs.sweepAlerts(todayLocal());
      run.alerts += await flushBatch();
    }
  } catch (error) {
    run.ok = false;
    run.error = String(error.message || error).slice(0, 300);
    setHistory(false);
    await flushBatch().catch(() => {});
  } finally {
    run.ms = Date.now() - started;
    try { writeRun(run); } catch { /* history is best effort */ }
    runtime.scanning = false;
  }
  return run;
}

export async function mailStatus({ withSource = false, refresh = false, source = mailSource() } = {}) {
  reconcileDeleted();
  const settings = mailSettings();
  const account = settings.account ? accountsApi.getAccount(settings.account) : null;
  const chosen = resolveMailAccount(settings);
  const month = thisMonth();
  const { from, to } = monthRange(month);
  const counts = db().prepare(
    `SELECT
       (SELECT COUNT(*) FROM mail_messages WHERE state = 'review') AS review,
       (SELECT COUNT(*) FROM mail_messages m JOIN entries e ON e.id = m.entry_id WHERE m.state = 'recorded' AND e.date >= ? AND e.date <= ?) AS recorded_month,
       (SELECT COUNT(*) FROM mail_messages WHERE state = 'duplicate') AS duplicates,
       (SELECT COUNT(*) FROM mail_messages) AS total`,
  ).get(from, to);
  const runs = listRuns(5);
  const out = {
    settings, account: account ? { id: account.id, name: account.name, currency: account.currency } : null,
    effective_account: chosen.account ? { id: chosen.account.id, name: chosen.account.name } : null,
    account_problem: chosen.account ? null : chosen.reason,
    scanning: runtime.scanning, scheduler_running: runtime.schedulerRunning, next_scan_ts: runtime.nextScanTs,
    last_run: runs[0] || null, last_ok_run: lastOkRun(), runs, counts,
  };
  if (withSource) out.source = await source.status({ refresh });
  return out;
}

/** Mails recorded since a timestamp (what one scan just did). */
export function recordedSince(iso, limit = 50) {
  return db().prepare("SELECT * FROM mail_messages WHERE state = 'recorded' AND created_at >= ? ORDER BY ts LIMIT ?").all(iso, limit).map(mailRow).map(presentMail);
}
