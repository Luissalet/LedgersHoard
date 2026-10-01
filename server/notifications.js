// Notifications: a stored list (last 200) for the UI and tools, a Windows
// toast through PowerShell (win32 only) and events on the Hoard family bus.
// A notification is created once per dedupe key; during a mail scan they are
// collected in a batch so a first scan of two months does not raise dozens of
// toasts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { db, uid, now, getSetting } from "./db.js";
import * as family from "./hoard-link.js";

export const MAX_STORED = 200;
export const SEVERITY_RANK = { low: 0, medium: 1, high: 2 };
const POWERSHELL_APP_ID = String.raw`{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe`;

export function xmlEscape(text) {
  return String(text ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

const httpUrl = (url) => (/^https?:\/\//i.test(String(url ?? "")) ? String(url) : "");

/** PowerShell that shows one toast through Windows.UI.Notifications (no module needed). */
export function buildToastPs1(title, body, url = "") {
  const launch = httpUrl(url);
  const attrs = launch ? ` activationType="protocol" launch="${xmlEscape(launch)}"` : "";
  const xml = `<toast${attrs}><visual><binding template="ToastGeneric"><text>${xmlEscape(String(title).slice(0, 120))}</text><text>${xmlEscape(String(body).slice(0, 300))}</text></binding></visual></toast>`;
  return [
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
    "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null",
    `$xml = @'\n${xml}\n'@`,
    "$doc = New-Object Windows.Data.Xml.Dom.XmlDocument",
    "$doc.LoadXml($xml)",
    "$toast = [Windows.UI.Notifications.ToastNotification]::new($doc)",
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${POWERSHELL_APP_ID}').Show($toast)`,
    "",
  ].join("\n");
}

const defaultPowershell = (exe, args, options) => new Promise((resolve) => {
  execFile(exe, args, { windowsHide: true, timeout: 20_000, ...options }, (error) => resolve({ code: error ? (error.code ?? 1) : 0, error: error?.message || "" }));
});

const backends = {
  platform: () => process.platform,
  powershell: defaultPowershell,
  tmpdir: () => os.tmpdir(),
  hub: (type, data) => family.emit(type, data),
};
const initial = { ...backends };

/** Tests swap the platform, the PowerShell runner and the hub emitter. */
export function setNotifyBackends(patch) {
  Object.assign(backends, patch);
}
export function resetNotifyBackends() {
  Object.assign(backends, initial);
}

/** Show one Windows toast; resolves "" on success or a short reason. */
export async function showToast(title, body, url = "") {
  if (backends.platform() !== "win32") return "no es Windows";
  const file = path.join(backends.tmpdir(), `ledger-toast-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ps1`);
  try {
    // BOM: Windows PowerShell 5.1 reads UTF-8 only with it
    fs.writeFileSync(file, String.fromCharCode(0xfeff) + buildToastPs1(title, body, url), "utf8");
    const done = await backends.powershell("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", file], { windowsHide: true });
    return done?.code === 0 || done?.code === undefined ? "" : `powershell ${done.code}`;
  } catch (error) {
    return error?.code || error?.name || "error";
  } finally {
    try { fs.unlinkSync(file); } catch { /* already gone */ }
  }
}

const row = (r) => (r ? { ...r, payload: JSON.parse(r.payload || "{}"), delivered: JSON.parse(r.delivered || "{}") } : null);

export function listNotifications({ limit = 50, kind = null } = {}) {
  const sql = kind ? "SELECT * FROM notifications WHERE kind = ? ORDER BY ts DESC, rowid DESC LIMIT ?" : "SELECT * FROM notifications ORDER BY ts DESC, rowid DESC LIMIT ?";
  const rows = kind ? db().prepare(sql).all(kind, limit) : db().prepare(sql).all(limit);
  return rows.map(row);
}

let batch = null;
export const beginBatch = () => { batch = batch || []; };

// The first read of the mailbox goes two months back: what it finds about old mail is history. Those notifications are
// stored (the Correo page lists them) but never pushed as a toast or on the family bus, so nobody gets old news rung.
export const HISTORY_AFTER_MS = 3 * 86400 * 1000;
let history = false;
/** True while the engine processes a mail that counts as history. */
export const setHistory = (value) => { history = Boolean(value); };
const isHistory = () => history;

/**
 * Store a notification once per dedupe key. spec: { kind, severity, title,
 * body, dedupe_key, payload, event (family bus type), url }. Returns the stored
 * notification, or null when that key already exists.
 */
export async function notify(spec) {
  const id = uid();
  const ts = now();
  const result = db().prepare(
    "INSERT OR IGNORE INTO notifications (id, ts, kind, severity, title, body, dedupe_key, payload, delivered) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}')",
  ).run(id, ts, spec.kind, spec.severity || "low", String(spec.title).slice(0, 200), String(spec.body || "").slice(0, 600), String(spec.dedupe_key).slice(0, 300), JSON.stringify(spec.payload || {}));
  if (!result.changes) return null;
  db().prepare("DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY ts DESC, rowid DESC LIMIT ?)").run(MAX_STORED);
  if (isHistory()) {
    db().prepare("UPDATE notifications SET severity = 'low', delivered = ? WHERE id = ?").run(JSON.stringify({ history: true }), id);
    return row(db().prepare("SELECT * FROM notifications WHERE id = ?").get(id));
  }
  const stored = row(db().prepare("SELECT * FROM notifications WHERE id = ?").get(id));
  const item = { ...stored, event: spec.event || `ledger.${spec.kind}`, url: spec.url || "" };
  if (batch) batch.push(item);
  else await deliver([item]);
  return stored;
}

function setDelivered(id, patch) {
  const current = db().prepare("SELECT delivered FROM notifications WHERE id = ?").get(id);
  if (!current) return;
  db().prepare("UPDATE notifications SET delivered = ? WHERE id = ?").run(JSON.stringify({ ...JSON.parse(current.delivered || "{}"), ...patch }), id);
}

const MAX_TOASTS = 3;

/** Deliver a list of new notifications: every one to the family bus, toasts condensed. */
export async function deliver(items) {
  if (!items.length) return;
  const toastOn = Boolean(Number(getSetting("notify.toast", 1)));
  const hubOn = Boolean(Number(getSetting("notify.hub", 1)));
  if (hubOn) {
    for (const item of items) {
      try { await backends.hub(item.event, { ...item.payload, severity: item.severity, title: item.title }); setDelivered(item.id, { hub: true }); } catch { setDelivered(item.id, { hub: false }); }
    }
  }
  if (!toastOn) return;
  const loud = items.filter((i) => SEVERITY_RANK[i.severity] >= 1);
  const quiet = items.filter((i) => SEVERITY_RANK[i.severity] < 1);
  const toasts = [];
  for (const item of loud.slice(0, MAX_TOASTS)) toasts.push({ ids: [item.id], title: item.title, body: item.body });
  const rest = [...loud.slice(MAX_TOASTS), ...quiet];
  if (rest.length === 1) toasts.push({ ids: [rest[0].id], title: rest[0].title, body: rest[0].body });
  else if (rest.length > 1) toasts.push({ ids: rest.map((i) => i.id), title: "Ledger's Hoard", body: `${rest.length} avisos nuevos: ${rest.slice(0, 3).map((i) => i.title).join(" · ")}${rest.length > 3 ? "…" : ""}` });
  for (const t of toasts) {
    const reason = await showToast(t.title, t.body);
    for (const id of t.ids) setDelivered(id, { toast: reason === "" ? true : reason });
  }
}

export async function flushBatch() {
  const items = batch || [];
  batch = null;
  await deliver(items);
  return items.length;
}
