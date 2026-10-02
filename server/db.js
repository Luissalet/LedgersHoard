// Single SQLite connection (node:sqlite, WAL, busy timeout) with ordered migrations, opened by Hoard Link's openDatabase.
// Only the HTTP server process opens the database; the MCP bridge proxies.
import path from "node:path";
import crypto from "node:crypto";
import { openDatabase } from "./hoard-commons/server.js";
import { merchantKey } from "./hoard-commons/merchants.js";

export const DB_FILE = "ledgers-hoard.db";

const MIGRATIONS = [
  `
  CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'bank',
    currency TEXT NOT NULL DEFAULT 'EUR',
    opening_balance INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX accounts_name ON accounts(name COLLATE NOCASE);
  CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'expense',
    parent_id TEXT NULL REFERENCES categories(id) ON DELETE SET NULL,
    monthly_budget INTEGER NULL,
    color TEXT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX categories_name ON categories(name COLLATE NOCASE);
  CREATE TABLE entries (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    category_id TEXT NULL REFERENCES categories(id) ON DELETE SET NULL,
    counterparty TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    source TEXT NOT NULL DEFAULT 'manual',
    import_hash TEXT NULL UNIQUE,
    transfer_id TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX entries_date ON entries(date);
  CREATE INDEX entries_account ON entries(account_id);
  CREATE INDEX entries_category ON entries(category_id);
  CREATE INDEX entries_transfer ON entries(transfer_id);
  CREATE TABLE imports (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    filename TEXT NOT NULL DEFAULT '',
    rows_total INTEGER NOT NULL DEFAULT 0,
    rows_added INTEGER NOT NULL DEFAULT 0,
    rows_skipped INTEGER NOT NULL DEFAULT 0,
    mapping TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE scenarios (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE scenario_lines (
    id TEXT PRIMARY KEY,
    scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    label TEXT NOT NULL,
    start_month TEXT NOT NULL,
    end_month TEXT NULL,
    cadence TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX scenario_lines_scenario ON scenario_lines(scenario_id);
  `,
  // Payments and subscriptions read from mail. entries.source_ref ties an
  // entry to the message that created it ("mail:<message-id>").
  `
  ALTER TABLE entries ADD COLUMN source_ref TEXT NULL;
  CREATE INDEX entries_source_ref ON entries(source_ref);
  CREATE TABLE mail_messages (
    message_id TEXT PRIMARY KEY,
    ts TEXT NOT NULL,
    sender TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'noise',
    state TEXT NOT NULL DEFAULT 'new',
    facts TEXT NOT NULL DEFAULT '{}',
    entry_id TEXT NULL,
    snippet TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX mail_messages_state ON mail_messages(state);
  CREATE INDEX mail_messages_ts ON mail_messages(ts);
  CREATE INDEX mail_messages_entry ON mail_messages(entry_id);
  CREATE TABLE subscriptions (
    id TEXT PRIMARY KEY,
    merchant TEXT NOT NULL,
    merchant_key TEXT NOT NULL UNIQUE,
    amount_cents INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'EUR',
    period TEXT NOT NULL DEFAULT 'unknown',
    status TEXT NOT NULL DEFAULT 'active',
    last_charge_date TEXT NULL,
    next_charge_date TEXT NULL,
    trial_end_date TEXT NULL,
    account_id TEXT NULL,
    category_id TEXT NULL,
    price_history TEXT NOT NULL DEFAULT '[]',
    source TEXT NOT NULL DEFAULT 'mail',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE mail_runs (
    id TEXT PRIMARY KEY,
    ts TEXT NOT NULL,
    trigger TEXT NOT NULL DEFAULT 'manual',
    ok INTEGER NOT NULL DEFAULT 1,
    error TEXT NOT NULL DEFAULT '',
    since_days INTEGER NOT NULL DEFAULT 0,
    scanned INTEGER NOT NULL DEFAULT 0,
    recorded INTEGER NOT NULL DEFAULT 0,
    review INTEGER NOT NULL DEFAULT 0,
    duplicates INTEGER NOT NULL DEFAULT 0,
    ignored INTEGER NOT NULL DEFAULT 0,
    alerts INTEGER NOT NULL DEFAULT 0,
    ms INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE notifications (
    id TEXT PRIMARY KEY,
    ts TEXT NOT NULL,
    kind TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'low',
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    dedupe_key TEXT NOT NULL UNIQUE,
    payload TEXT NOT NULL DEFAULT '{}',
    delivered TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX notifications_ts ON notifications(ts);
  `,
  // Family links: documents attached to a movement (references to other apps' records), shared expenses with the people
  // who owe a share, their settlements, and the sales lines already booked as income (idempotent by batch + line).
  `
  ALTER TABLE entries ADD COLUMN docs TEXT NOT NULL DEFAULT '[]';
  CREATE TABLE splits (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    person_key TEXT NOT NULL,
    person_ref TEXT NOT NULL DEFAULT '',
    person_name TEXT NOT NULL,
    share_cents INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX splits_entry_person ON splits(entry_id, person_key);
  CREATE INDEX splits_person ON splits(person_key);
  CREATE TABLE settlements (
    id TEXT PRIMARY KEY,
    person_key TEXT NOT NULL,
    person_ref TEXT NOT NULL DEFAULT '',
    person_name TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    entry_id TEXT NULL REFERENCES entries(id) ON DELETE SET NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX settlements_person ON settlements(person_key);
  CREATE TABLE sales_lines (
    batch TEXT NOT NULL,
    line INTEGER NOT NULL,
    entry_id TEXT NULL REFERENCES entries(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (batch, line)
  );
  `,
  // Hoard Link's merchant keys: a merchant that is not in the family table is keyed by its folded name without the legal suffix
  // ("bar manolo s l" is now "bar manolo"), and the table knows more merchants. What was stored under the old key is re-keyed once.
  rekeyMerchants,
];

/** The key the app used before the shared merchant table: the folded name, punctuation as single spaces. */
const legacyKey = (name) => String(name ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");

function rekeyMerchants(raw) {
  const taken = new Set(raw.prepare("SELECT merchant_key FROM subscriptions").all().map((r) => r.merchant_key));
  for (const row of raw.prepare("SELECT id, merchant, merchant_key FROM subscriptions").all()) {
    if (row.merchant_key !== legacyKey(row.merchant)) continue;          // a known merchant, or a key built another way (Google Play products)
    const next = merchantKey(row.merchant);
    if (!next || next === row.merchant_key || taken.has(next)) continue;
    raw.prepare("UPDATE subscriptions SET merchant_key = ? WHERE id = ?").run(next, row.id);
    taken.delete(row.merchant_key);
    taken.add(next);
  }
  for (const row of raw.prepare("SELECT message_id, facts FROM mail_messages WHERE json_extract(facts, '$.merchant_key') IS NOT NULL").all()) {
    let facts;
    try { facts = JSON.parse(row.facts); } catch { continue; }
    if (!facts.merchant || facts.merchant_key !== legacyKey(facts.merchant)) continue;
    const next = merchantKey(facts.merchant);
    if (!next || next === facts.merchant_key) continue;
    raw.prepare("UPDATE mail_messages SET facts = ? WHERE message_id = ?").run(JSON.stringify({ ...facts, merchant_key: next }), row.message_id);
  }
}

let database = null;
let dataDirectory = null;

export function init(dataDir) {
  if (database) return database.raw;
  database = openDatabase(path.join(dataDir, DB_FILE), { migrations: MIGRATIONS });
  dataDirectory = dataDir;
  return database.raw;
}

export function db() {
  if (!database) throw new Error("Database not initialised. Call init(dataDir) first.");
  return database.raw;
}

export function dataDir() {
  return dataDirectory;
}

/** Checkpoints the WAL and closes. */
export function close() {
  if (database) database.close();
  database = null;
  dataDirectory = null;
}

export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

/** Run fn inside a transaction (BEGIN IMMEDIATE); a nested call is a savepoint. fn must be synchronous. */
export function transaction(fn) {
  if (!database) db();
  return database.tx(fn);
}

export function getSetting(key, fallback = null) {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? JSON.parse(row.value) : fallback;
}

export function setSetting(key, value) {
  db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, JSON.stringify(value));
  return value;
}
