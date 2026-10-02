// Finding the movement of an invoice (tx_find) and keeping the documents of other apps on a movement (tx_attach_doc).
// A "tx" is an entry; its id is the one in hoard://ledger/tx/<id>.
import { db, now } from "./db.js";
import { addDays, daysBetween, parseDate } from "./dates.js";
import { parseAmount, formatCents } from "./money.js";
import { merchantMatches } from "./mail-match.js";
import { getEntry } from "./entries.js";
import { familyApi } from "./family.js";

const fail = (message, status = 400, extra = {}) => { throw Object.assign(new Error(message), { status, ...extra }); };
const decimal = (cents) => Math.round(Math.abs(cents)) / 100;

/**
 * Score of a candidate: the amount is equal (0.3), the date is close (up to 0.3, linear over the window) and the merchant
 * agrees (0.4; 0.1 when none was given, 0 when it disagrees). A same-day movement of the same merchant scores 1.
 */
export function scoreMatch({ distanceDays, days, merchant, counterparty, note }) {
  const date = 0.3 * (1 - Math.min(distanceDays, days) / (days + 1));
  let who = 0.1;
  if (merchant) who = merchantMatches(merchant, counterparty) || merchantMatches(merchant, note) ? 0.4 : 0;
  return Math.round((0.3 + date + who) * 100) / 100;
}

/** Expense movements with exactly that amount within `days` of the date, best match first. */
export function txFind({ amount, date, merchant = "", days = 5, currency = "" }) {
  const cents = parseAmount(amount);
  if (cents === null || cents === 0) fail(`Importe no reconocido: "${amount}".`);
  const day = parseDate(String(date ?? "")) || fail(`Fecha no válida: "${date}".`);
  const window = Math.max(0, Math.min(60, Math.trunc(Number(days) || 5)));
  const wanted = Math.abs(cents);
  const rows = db().prepare(
    `SELECT e.id, e.date, e.amount_cents, e.counterparty, e.note, e.docs, a.name AS account_name, a.currency
     FROM entries e JOIN accounts a ON a.id = e.account_id
     WHERE e.amount_cents = ? AND e.date >= ? AND e.date <= ? AND e.transfer_id IS NULL ORDER BY e.date`,
  ).all(-wanted, addDays(day, -window), addDays(day, window));
  const code = String(currency || "").trim().toUpperCase();
  const matches = rows
    .filter((r) => !code || r.currency === code)
    .map((r) => ({
      tx_id: r.id, date: r.date, amount: decimal(r.amount_cents), amount_cents: r.amount_cents, currency: r.currency,
      merchant: r.counterparty, account: r.account_name, docs: JSON.parse(r.docs || "[]").length,
      score: scoreMatch({ distanceDays: Math.abs(daysBetween(r.date, day)), days: window, merchant, counterparty: r.counterparty, note: r.note }),
    }))
    .sort((a, b) => b.score - a.score || a.date.localeCompare(b.date));
  return { ok: true, count: matches.length, matches };
}

const REF = /^hoard:\/\/[a-z0-9_-]+\/[a-z0-9_-]+\/\S+$/i;

/** Keep a reference to another app's record on a movement (idempotent: the same ref only updates its label). */
export function attachDoc(txId, docRef, label = "") {
  const entry = getEntry(String(txId || "")) || fail("No existe ese movimiento.", 404);
  const ref = String(docRef || "").trim();
  if (!REF.test(ref) || ref.length > 400) fail("doc_ref debe ser una referencia hoard://app/tipo/id.");
  const docs = entry.docs.filter((d) => d.ref !== ref);
  const text = String(label || "").trim().slice(0, 160);
  const previous = entry.docs.find((d) => d.ref === ref);
  const item = { ref, label: text || previous?.label || "", added_at: previous?.added_at || now() };
  docs.push(item);
  db().prepare("UPDATE entries SET docs = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(docs), now(), entry.id);
  return { ok: true, tx_id: entry.id, doc: item, docs, already: Boolean(previous) };
}

export function detachDoc(txId, docRef) {
  const entry = getEntry(String(txId || "")) || fail("No existe ese movimiento.", 404);
  const docs = entry.docs.filter((d) => d.ref !== docRef);
  db().prepare("UPDATE entries SET docs = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(docs), now(), entry.id);
  return { ok: true, tx_id: entry.id, docs };
}

/** Where a reference opens: the app's address from the hub, and the page of the record when the app is known. */
export async function resolveDocUrl(ref) {
  const m = /^hoard:\/\/([a-z0-9_-]+)\/([a-z0-9_-]+)\/(\S+)$/i.exec(String(ref || ""));
  if (!m) return { ok: false, error: "Referencia no válida." };
  const [, app, kind, id] = m;
  let base = "";
  try { base = String((await familyApi().appInfo?.(app))?.url || "").replace(/\/+$/, ""); } catch { base = ""; }
  if (!base) return { ok: false, app, error: `No se encuentra la dirección de ${app} (¿está el hub en marcha?).` };
  const page = app === "kafka" && kind === "document" ? `/#/documentos/${encodeURIComponent(id)}` : "";
  return { ok: true, app, url: base + page };
}

export const txLabel = (entry) => `${entry.counterparty || "Movimiento"} ${formatCents(entry.amount_cents)}`.trim();
