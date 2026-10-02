// Database-level checks of what Ledger takes from the commons: the re-keying migration and the stable MCP token.
// (Own file: they open and close the process-wide database.)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tempDir } from "./helpers.js";
import { db, init, close } from "../server/db.js";
import { createSubscription } from "../server/subscriptions.js";
import { createApp } from "../server/app.js";

// ------------------------------------------------------------------ migration 5: keys of unknown merchants
test("migration 5 re-keys what the old key scheme stored, once, and leaves clashes alone", () => {
  const dir = tempDir();
  try {
    init(dir);
    const a = createSubscription({ merchant: "Bar Manolo S.L.", amount_cents: 1000, period: "monthly", next_charge_date: "2026-11-01" });
    const raw = db();
    raw.prepare("UPDATE subscriptions SET merchant_key = ? WHERE id = ?").run("bar manolo s l", a.id);
    raw.prepare("INSERT INTO mail_messages (message_id, ts, facts, created_at) VALUES ('m1', '2026-10-01T00:00:00Z', ?, '2026-10-01T00:00:00Z')").run(JSON.stringify({ merchant: "Bar Manolo S.L.", merchant_key: "bar manolo s l" }));
    raw.exec("DELETE FROM schema_version WHERE version = 5");
    close();
    init(dir);
    assert.equal(db().prepare("SELECT merchant_key FROM subscriptions WHERE id = ?").get(a.id).merchant_key, "bar manolo");
    assert.equal(JSON.parse(db().prepare("SELECT facts FROM mail_messages WHERE message_id = 'm1'").get().facts).merchant_key, "bar manolo");
    close();
    init(dir);
    assert.equal(db().prepare("SELECT merchant_key FROM subscriptions WHERE id = ?").get(a.id).merchant_key, "bar manolo", "the second run changes nothing");
  } finally {
    close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the MCP token is stable across restarts of the app on the same data folder", () => {
  const dir = tempDir();
  try {
    const first = createApp({ dataDir: dir, serveStatic: false });
    const second = createApp({ dataDir: dir, serveStatic: false });
    assert.equal(first.token, second.token);
    assert.equal(fs.readFileSync(path.join(dir, "mcp-token"), "utf8").trim(), first.token);
  } finally {
    close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

