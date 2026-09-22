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
