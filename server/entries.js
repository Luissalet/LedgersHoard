import { z } from "zod";
import { db, uid, now, transaction } from "./db.js";
import { getAccount } from "./accounts.js";
import { getCategory } from "./categories.js";
import { parseDate, today } from "./dates.js";

export const ENTRY_SOURCES = ["manual", "agent", "import"];

const dateField = z.string().transform((v, ctx) => {
  const parsed = parseDate(v);
  if (!parsed) ctx.addIssue({ code: "custom", message: "Fecha no válida (usa YYYY-MM-DD)." });
  return parsed;
});

// Field definitions without defaults; zod's .partial() keeps defaults, so
// the patch schema is derived from this bare shape and the create schema
// adds defaults on top.
const entryShape = {
  date: dateField,
  amount_cents: z.number().int().refine((n) => n !== 0, "El importe no puede ser cero."),
  account_id: z.string().min(1),
  category_id: z.string().nullable(),
  counterparty: z.string().trim().max(200),
  note: z.string().trim().max(2000),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  source: z.enum(ENTRY_SOURCES),
  import_hash: z.string().max(64).nullable(),
  transfer_id: z.string().nullable(),
};
export const entryInput = z.object({
  ...entryShape,
  date: dateField.default(() => today()),
  category_id: entryShape.category_id.default(null),
  counterparty: entryShape.counterparty.default(""),
  note: entryShape.note.default(""),
  tags: entryShape.tags.default([]),
  source: entryShape.source.default("manual"),
  import_hash: entryShape.import_hash.default(null),
  transfer_id: entryShape.transfer_id.default(null),
});
export const entryPatch = z.object(entryShape).partial();

export const entryFilter = z.object({
  from: dateField.optional(),
  to: dateField.optional(),
  account: z.string().optional(),
  category: z.string().optional(),
  text: z.string().trim().max(200).optional(),
  tag: z.string().trim().max(40).optional(),
  source: z.enum(ENTRY_SOURCES).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
  order: z.enum(["asc", "desc"]).default("desc"),
});

const SELECT = `SELECT e.*, a.name AS account_name, c.name AS category_name, c.kind AS category_kind
  FROM entries e
  JOIN accounts a ON a.id = e.account_id
  LEFT JOIN categories c ON c.id = e.category_id`;

const row = (r) => (r ? { ...r, tags: JSON.parse(r.tags || "[]") } : null);

export function getEntry(id) {
  return row(db().prepare(`${SELECT} WHERE e.id = ?`).get(id));
}

function checkRefs(data) {
  if (!getAccount(data.account_id)) throw Object.assign(new Error("La cuenta no existe."), { status: 400 });
  if (data.category_id && !getCategory(data.category_id)) throw Object.assign(new Error("La categoría no existe."), { status: 400 });
}

export function createEntry(input) {
  const data = entryInput.parse(input);
  checkRefs(data);
  const id = uid();
  const ts = now();
  db().prepare(
    `INSERT INTO entries (id, date, amount_cents, account_id, category_id, counterparty, note, tags, source, import_hash, transfer_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, data.date, data.amount_cents, data.account_id, data.category_id, data.counterparty, data.note,
    JSON.stringify(data.tags), data.source, data.import_hash, data.transfer_id, ts, ts);
  return getEntry(id);
}

export function updateEntry(id, patch) {
  const current = getEntry(id);
  if (!current) return null;
  const data = entryPatch.parse(patch);
  const next = { ...current, ...data };
  checkRefs(next);
  db().prepare(
    `UPDATE entries SET date = ?, amount_cents = ?, account_id = ?, category_id = ?, counterparty = ?, note = ?, tags = ?, updated_at = ?
     WHERE id = ?`,
  ).run(next.date, next.amount_cents, next.account_id, next.category_id, next.counterparty, next.note,
    JSON.stringify(next.tags), now(), id);
  return getEntry(id);
}

/** Delete an entry; a transfer removes both linked halves. */
export function deleteEntry(id) {
  const entry = getEntry(id);
  if (!entry) return false;
  if (entry.transfer_id) db().prepare("DELETE FROM entries WHERE transfer_id = ?").run(entry.transfer_id);
  else db().prepare("DELETE FROM entries WHERE id = ?").run(id);
  return true;
}

export function hasImportHash(hash) {
  return !!db().prepare("SELECT 1 FROM entries WHERE import_hash = ?").get(hash);
}

/** Build WHERE clause + params from a parsed filter. */
function where(f) {
  const clauses = [];
  const params = [];
  if (f.from) { clauses.push("e.date >= ?"); params.push(f.from); }
  if (f.to) { clauses.push("e.date <= ?"); params.push(f.to); }
  if (f.account) { clauses.push("e.account_id = ?"); params.push(f.account); }
  if (f.category === "none") clauses.push("e.category_id IS NULL");
  else if (f.category) { clauses.push("e.category_id = ?"); params.push(f.category); }
  if (f.source) { clauses.push("e.source = ?"); params.push(f.source); }
  if (f.tag) { clauses.push("e.tags LIKE ?"); params.push(`%${JSON.stringify(f.tag).slice(1, -1)}%`); }
  if (f.text) {
    clauses.push("(e.counterparty LIKE ? OR e.note LIKE ? OR e.tags LIKE ? OR COALESCE(c.name, '') LIKE ?)");
    const like = `%${f.text}%`;
    params.push(like, like, like, like);
  }
  return { sql: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "", params };
}

export function listEntries(filter = {}) {
  const f = entryFilter.parse(filter);
  const { sql, params } = where(f);
  const order = f.order === "asc" ? "ASC" : "DESC";
  const total = db().prepare(`SELECT COUNT(*) AS n FROM entries e LEFT JOIN categories c ON c.id = e.category_id${sql}`).get(...params).n;
  const items = db().prepare(`${SELECT}${sql} ORDER BY e.date ${order}, e.created_at ${order} LIMIT ? OFFSET ?`)
    .all(...params, f.limit, f.offset).map(row);
  return { total, items, nextOffset: f.offset + f.limit < total ? f.offset + f.limit : null };
}

export const transferInput = z.object({
  from_account_id: z.string().min(1),
  to_account_id: z.string().min(1),
  amount_cents: z.number().int().positive(),
  date: dateField.default(() => today()),
  note: z.string().trim().max(2000).default(""),
  source: z.enum(ENTRY_SOURCES).default("manual"),
});

/** Move money between accounts: two linked entries, excluded from totals. */
export function createTransfer(input) {
  const data = transferInput.parse(input);
  if (data.from_account_id === data.to_account_id) throw Object.assign(new Error("Las cuentas deben ser distintas."), { status: 400 });
  const from = getAccount(data.from_account_id);
  const to = getAccount(data.to_account_id);
  if (!from || !to) throw Object.assign(new Error("La cuenta no existe."), { status: 400 });
  const transfer_id = uid();
  return transaction(() => {
    const out = createEntry({
      date: data.date, amount_cents: -data.amount_cents, account_id: from.id, counterparty: `Traspaso a ${to.name}`,
      note: data.note, source: data.source, transfer_id, tags: ["traspaso"],
    });
    const back = createEntry({
      date: data.date, amount_cents: data.amount_cents, account_id: to.id, counterparty: `Traspaso desde ${from.name}`,
      note: data.note, source: data.source, transfer_id, tags: ["traspaso"],
    });
    return { transfer_id, out, in: back };
  });
}
