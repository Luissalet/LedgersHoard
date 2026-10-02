// Single SQLite connection (node:sqlite, WAL) with ordered migrations.
// Only the HTTP server process opens the database; the MCP bridge proxies.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

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
];

let connection = null;
let dataDirectory = null;

export function init(dataDir) {
  if (connection) return connection;
  fs.mkdirSync(dataDir, { recursive: true });
  dataDirectory = dataDir;
  connection = new DatabaseSync(path.join(dataDir, DB_FILE));
  connection.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  migrate(connection);
  return connection;
}

export function db() {
  if (!connection) throw new Error("Database not initialised. Call init(dataDir) first.");
  return connection;
}

export function dataDir() {
  return dataDirectory;
}

export function close() {
  if (connection) connection.close();
  connection = null;
  dataDirectory = null;
}

function migrate(conn) {
  conn.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const row = conn.prepare("SELECT MAX(version) AS v FROM schema_version").get();
  const current = row?.v || 0;
  for (let i = current; i < MIGRATIONS.length; i++) {
    conn.exec("BEGIN");
    try {
      conn.exec(MIGRATIONS[i]);
      conn.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(i + 1, now());
      conn.exec("COMMIT");
    } catch (error) {
      conn.exec("ROLLBACK");
      throw error;
    }
  }
}

export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

/** Run fn inside a transaction; nested calls reuse the outer one. */
let depth = 0;
export function transaction(fn) {
  const conn = db();
  if (depth > 0) return fn();
  conn.exec("BEGIN");
  depth++;
  try {
    const out = fn();
    conn.exec("COMMIT");
    return out;
  } catch (error) {
    conn.exec("ROLLBACK");
    throw error;
  } finally {
    depth--;
  }
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
