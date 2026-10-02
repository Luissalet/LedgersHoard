// Shared expenses: a movement paid by the user is split among people who owe a share; settlements pay it back.
// People are looked up in the address book (People's find_people, through the hub) and their name is stored too, so the
// balances still work when the hub or People is away. A positive balance is what the person owes the user.
import { db, uid, now, transaction } from "./db.js";
import { parseAmount, formatCents } from "./money.js";
import { getEntry } from "./entries.js";
import { callApp } from "./family.js";
import { fold } from "./mail-merchants.js";

const fail = (message, status = 400, extra = {}) => { throw Object.assign(new Error(message), { status, ...extra }); };
const money = (cents) => formatCents(cents);
const PERSON_URI = /^hoard:\/\/people\/person\/(\S+)$/i;
const looksLikeId = (text) => /^[0-9a-f-]{8,}$/i.test(text);

/** Who the text names: the address book's person when exactly one fits, else the name as written. */
export async function resolvePerson(input) {
  const text = String(input ?? "").trim();
  if (!text) fail("Falta la persona.");
  const uri = PERSON_URI.exec(text);
  if (uri) {
    const got = await callApp("people", "get_person", { person: uri[1] });
    const person = got.ok ? (got.result?.person || got.result) : null;
    return person?.name ? { name: String(person.name), ref: `hoard://people/person/${person.id || uri[1]}`, resolved: true } : { name: text, ref: text, resolved: false };
  }
  const found = await callApp("people", "find_people", { query: text, limit: 5 });
  const candidates = found.ok ? (found.result?.candidates || []).filter((c) => c && c.id && c.name) : [];
  if (found.ok && candidates.length) {
    const exact = candidates.filter((c) => fold(c.name) === fold(text) || (c.nickname && fold(c.nickname) === fold(text)));
    const top = Math.max(...candidates.map((c) => Number(c.score) || 0));
    const best = exact.length === 1 ? exact : candidates.filter((c) => (Number(c.score) || 0) === top);
    if (best.length === 1 && (exact.length === 1 || top >= 0.6)) {
      return { name: String(best[0].name), ref: `hoard://people/person/${best[0].id}`, resolved: true };
    }
    fail(`"${text}" puede ser varias personas: ${candidates.map((c) => c.name).join(", ")}. Indica cuál.`, 400, { candidates: candidates.map((c) => c.name) });
  }
  if (found.ok && !candidates.length && looksLikeId(text)) {
    const got = await callApp("people", "get_person", { person: text });
    const person = got.ok ? (got.result?.person || got.result) : null;
    if (person?.name) return { name: String(person.name), ref: `hoard://people/person/${person.id || text}`, resolved: true };
  }
  return { name: text, ref: "", resolved: false, note: found.ok ? "no está en la agenda: se apunta solo con el nombre" : `la agenda no respondió (${found.error}): se apunta solo con el nombre` };
}

const keyOf = (p) => p.ref || fold(p.name);

function shareCents(total, entry) {
  if (entry.amount !== undefined && entry.amount !== null && entry.amount !== "") {
    const cents = parseAmount(entry.amount);
    if (cents === null || cents <= 0) fail(`Importe no reconocido: "${entry.amount}".`);
    return cents;
  }
  const share = Number(entry.share);
  if (!Number.isFinite(share) || share <= 0) fail(`Parte no válida para ${entry.person}: usa una fracción (0,25), un porcentaje (25) o amount.`);
  const fraction = share <= 1 ? share : share / 100;
  if (fraction > 1) fail(`Parte no válida para ${entry.person}: más del 100 %.`);
  return Math.round(total * fraction);
}

/** Split an expense among people. Idempotent per movement and person: repeating it updates their share. */
export async function addSplit({ tx_id, participants }) {
  const entry = getEntry(String(tx_id || "")) || fail("No existe ese movimiento.", 404);
  if (entry.transfer_id) fail("Un traspaso no se reparte.");
  if (entry.amount_cents >= 0) fail("Solo se reparte un gasto que pagaste tú.");
  if (!Array.isArray(participants) || !participants.length) fail("Indica al menos una persona.");
  const total = -entry.amount_cents;
  const people = [];
  for (const p of participants) people.push({ who: await resolvePerson(p.person), spec: p });
  const seen = new Set();
  for (const p of people) {
    const key = keyOf(p.who);
    if (seen.has(key)) fail(`${p.who.name} aparece dos veces.`);
    seen.add(key);
  }
  const given = people.filter((p) => (p.spec.amount !== undefined && p.spec.amount !== null && p.spec.amount !== "") || p.spec.share !== undefined);
  if (given.length && given.length !== people.length) fail("Indica la parte (share o amount) de todas las personas, o de ninguna para repartir a partes iguales.");
  const equal = !given.length;
  const each = equal ? Math.floor(total / (people.length + 1)) : 0;
  const shares = people.map((p) => (equal ? each : shareCents(total, { ...p.spec, person: p.who.name })));
  const sum = shares.reduce((a, b) => a + b, 0);
  if (sum > total) fail(`Reparto de ${money(sum)} para un gasto de ${money(total)}.`);
  transaction(() => {
    people.forEach((p, i) => {
      db().prepare(
        `INSERT INTO splits (id, entry_id, person_key, person_ref, person_name, share_cents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(entry_id, person_key) DO UPDATE SET share_cents = excluded.share_cents, person_name = excluded.person_name, person_ref = excluded.person_ref`,
      ).run(uid(), entry.id, keyOf(p.who), p.who.ref, p.who.name, shares[i], now());
    });
  });
  return {
    ok: true, tx_id: entry.id, total_cents: total, total: money(total), my_share_cents: total - sum, my_share: money(total - sum),
    participants: people.map((p, i) => ({ person: p.who.name, person_ref: p.who.ref, resolved: p.who.resolved, share_cents: shares[i], share: money(shares[i]), ...(p.who.note ? { note: p.who.note } : {}) })),
    ...(equal ? { note: "Sin partes indicadas: a partes iguales entre las personas y tú." } : {}),
  };
}

const rowsFor = () => db().prepare(
  `SELECT s.person_key, s.person_ref, s.person_name, s.share_cents, e.date, e.id AS entry_id, e.counterparty
   FROM splits s JOIN entries e ON e.id = s.entry_id ORDER BY e.date, s.created_at`,
).all();
const paidRows = () => db().prepare("SELECT person_key, person_ref, person_name, amount_cents, created_at FROM settlements").all();

function aggregate() {
  const people = new Map();
  const at = (r) => {
    // a person written by name before the address book knew them and by reference after is one person
    let p = (r.person_ref && people.get(r.person_ref))
      || [...people.values()].find((x) => fold(x.person_name) === fold(r.person_name) && (!x.person_ref || !r.person_ref || x.person_ref === r.person_ref));
    if (!p) {
      const key = r.person_ref || r.person_key;
      p = { key, person_ref: r.person_ref, person_name: r.person_name, owed_cents: 0, paid_cents: 0, splits: [] };
      people.set(key, p);
    }
    if (r.person_ref && !p.person_ref) { p.person_ref = r.person_ref; p.person_name = r.person_name; }
    return p;
  };
  for (const r of rowsFor()) { const p = at(r); p.owed_cents += r.share_cents; p.splits.push(r); }
  for (const r of paidRows()) at(r).paid_cents += r.amount_cents;
  return [...people.values()].map((p) => {
    let credit = p.paid_cents;
    let oldest = null;
    let open = 0;
    for (const s of p.splits) {
      const covered = Math.min(credit, s.share_cents);
      credit -= covered;
      if (covered < s.share_cents) { open++; oldest = oldest || s.date; }
    }
    const balance = p.owed_cents - p.paid_cents;
    return {
      person: p.person_name, person_ref: p.person_ref, owed_cents: p.owed_cents, paid_cents: p.paid_cents, balance_cents: balance, balance: money(balance),
      direction: balance > 0 ? "owes_me" : balance < 0 ? "i_owe" : "settled", oldest_open_date: balance > 0 ? oldest : null, open_splits: balance > 0 ? open : 0,
      expenses: p.splits.map((s) => ({ tx_id: s.entry_id, date: s.date, merchant: s.counterparty, share_cents: s.share_cents })),
    };
  }).sort((a, b) => b.balance_cents - a.balance_cents || a.person.localeCompare(b.person));
}

const matches = (row, who, text) => (who.ref && row.person_ref === who.ref) || fold(row.person_name) === fold(who.name) || fold(row.person_name) === fold(text)
  || (!who.resolved && fold(row.person_name).includes(fold(text)));

/** Who owes whom, per person (all of them without `person`). */
export async function splitsBalance({ person } = {}) {
  let balances = aggregate();
  if (person) {
    const who = await resolvePerson(person);
    balances = balances.filter((b) => matches({ person_ref: b.person_ref, person_name: b.person }, who, person));
  }
  const owed = balances.filter((b) => b.balance_cents > 0).reduce((s, b) => s + b.balance_cents, 0);
  return { ok: true, count: balances.length, balances, owed_to_me_cents: owed, owed_to_me: money(owed),
    note: "Saldo positivo: la persona te debe esa cantidad. Todo en la divisa de las cuentas; no se mezclan divisas." };
}

/** The person pays back an amount (optionally the income movement that received it). */
export async function splitSettle({ person, amount, tx_id = "", note = "" }) {
  const cents = parseAmount(amount);
  if (cents === null || cents <= 0) fail(`Importe no reconocido: "${amount}".`);
  const who = await resolvePerson(person);
  const row = aggregate().find((b) => matches({ person_ref: b.person_ref, person_name: b.person }, who, person));
  if (!row || row.balance_cents <= 0) fail(`${who.name} no te debe nada.`, 409, { balance_cents: row?.balance_cents ?? 0 });
  if (cents > row.balance_cents) fail(`${who.name} te debe ${row.balance}; ${money(cents)} es más de lo que debe.`, 409, { balance_cents: row.balance_cents });
  if (tx_id && !getEntry(String(tx_id))) fail("No existe ese movimiento.", 404);
  const id = uid();
  db().prepare("INSERT INTO settlements (id, person_key, person_ref, person_name, amount_cents, entry_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, keyOf({ ref: row.person_ref, name: row.person }), row.person_ref, row.person, cents, tx_id || null, String(note || "").slice(0, 300), now());
  const after = row.balance_cents - cents;
  return { ok: true, settlement_id: id, person: row.person, person_ref: row.person_ref, amount_cents: cents, amount: money(cents), balance_cents: after, balance: money(after), settled: after === 0 };
}

/** Debts of more than `days` days (for the agenda): [{ person, balance_cents, since }]. */
export function oldDebts(days, today) {
  return aggregate().filter((b) => b.balance_cents > 0 && b.oldest_open_date && (Date.parse(today) - Date.parse(b.oldest_open_date)) / 86_400_000 > days)
    .map((b) => ({ person: b.person, person_ref: b.person_ref, balance_cents: b.balance_cents, balance: b.balance, since: b.oldest_open_date }));
}

/** The shares of one movement. */
export function splitsOf(entryId) {
  return db().prepare("SELECT person_name AS person, person_ref, share_cents FROM splits WHERE entry_id = ? ORDER BY created_at").all(entryId)
    .map((r) => ({ ...r, share: money(r.share_cents) }));
}

/** Take one person off a movement's split. */
export function removeSplit(entryId, person) {
  const key = fold(person);
  const res = db().prepare("DELETE FROM splits WHERE entry_id = ? AND (person_ref = ? OR person_key = ? OR lower(person_name) = lower(?))").run(entryId, String(person), key, String(person));
  return { ok: true, removed: Number(res.changes) };
}
