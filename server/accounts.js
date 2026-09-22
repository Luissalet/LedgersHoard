import { z } from "zod";
import { db, uid, now } from "./db.js";

export const ACCOUNT_TYPES = ["cash", "bank", "card", "savings", "other"];

const accountShape = {
  name: z.string().trim().min(1).max(80),
  type: z.enum(ACCOUNT_TYPES),
  currency: z.string().trim().length(3).toUpperCase(),
  opening_balance: z.number().int(),
  archived: z.boolean(),
};
export const accountInput = z.object({
  ...accountShape,
  type: accountShape.type.default("bank"),
  currency: accountShape.currency.default("EUR"),
  opening_balance: accountShape.opening_balance.default(0),
  archived: accountShape.archived.default(false),
});
// .partial() would keep the defaults above, so patches use the bare shape.
export const accountPatch = z.object(accountShape).partial();

const row = (r) => (r ? { ...r, archived: !!r.archived } : null);

export function listAccounts({ includeArchived = true } = {}) {
  const sql = includeArchived
    ? "SELECT * FROM accounts ORDER BY archived, created_at"
    : "SELECT * FROM accounts WHERE archived = 0 ORDER BY created_at";
  return db().prepare(sql).all().map(row);
}

export function getAccount(id) {
  return row(db().prepare("SELECT * FROM accounts WHERE id = ?").get(id));
}

export function findAccountByName(name) {
  return row(db().prepare("SELECT * FROM accounts WHERE name = ? COLLATE NOCASE").get(String(name).trim()));
}

/** Resolve by id, exact name (case-insensitive) or unique prefix/substring. */
export function resolveAccount(ref) {
  if (!ref) return null;
  const text = String(ref).trim();
  const byId = getAccount(text);
  if (byId) return byId;
  const exact = findAccountByName(text);
  if (exact) return exact;
  const needle = text.toLowerCase();
  const matches = listAccounts({ includeArchived: false }).filter((a) => a.name.toLowerCase().includes(needle));
  return matches.length === 1 ? matches[0] : null;
}

export function createAccount(input) {
  const data = accountInput.parse(input);
  if (findAccountByName(data.name)) throw Object.assign(new Error("Ya existe una cuenta con ese nombre."), { status: 409 });
  const id = uid();
  db().prepare(
    "INSERT INTO accounts (id, name, type, currency, opening_balance, archived, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, data.name, data.type, data.currency, data.opening_balance, data.archived ? 1 : 0, now());
  return getAccount(id);
}

export function updateAccount(id, patch) {
  const current = getAccount(id);
  if (!current) return null;
  const data = accountPatch.parse(patch);
  if (data.name) {
    const clash = findAccountByName(data.name);
    if (clash && clash.id !== id) throw Object.assign(new Error("Ya existe una cuenta con ese nombre."), { status: 409 });
  }
  const next = { ...current, ...data };
  db().prepare(
    "UPDATE accounts SET name = ?, type = ?, currency = ?, opening_balance = ?, archived = ? WHERE id = ?",
  ).run(next.name, next.type, next.currency, next.opening_balance, next.archived ? 1 : 0, id);
  return getAccount(id);
}

export function deleteAccount(id) {
  const used = db().prepare("SELECT COUNT(*) AS n FROM entries WHERE account_id = ?").get(id).n;
  if (used > 0) throw Object.assign(new Error("La cuenta tiene movimientos; archívala en lugar de borrarla."), { status: 409 });
  return db().prepare("DELETE FROM accounts WHERE id = ?").run(id).changes > 0;
}

/** Balance of one account at a date (inclusive), opening balance included. */
export function accountBalance(id, at = null) {
  const account = getAccount(id);
  if (!account) return null;
  const sum = at
    ? db().prepare("SELECT COALESCE(SUM(amount_cents), 0) AS s FROM entries WHERE account_id = ? AND date <= ?").get(id, at).s
    : db().prepare("SELECT COALESCE(SUM(amount_cents), 0) AS s FROM entries WHERE account_id = ?").get(id).s;
  return account.opening_balance + sum;
}

/** All accounts with their current balance. */
export function accountBalances(at = null) {
  return listAccounts().map((a) => ({ ...a, balance: accountBalance(a.id, at) }));
}
