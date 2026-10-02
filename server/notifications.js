// Notifications: a stored list (last 200) for the UI and tools, the person told through the family hub's notification facet
// (quiet hours, spheres, phone) with a Windows toast on this computer as the fallback, and events on the Hoard family bus.
// A notification is created once per dedupe key; during a mail scan they are
// collected in a batch so a first scan of two months does not raise dozens of
// toasts.
import { db, uid, now, getSetting } from "./db.js";
import * as family from "./hoard-link.js";

// The toast itself (the PowerShell script, escaping, hidden window) is the family's. Re-exported because the tests and callers
// have always imported them from here.
export { buildToastPs1, xmlEscape } from "./hoard-link.js";

export const MAX_STORED = 200;
export const SEVERITY_RANK = { low: 0, medium: 1, high: 2 };
const APP_NAME = "Ledger's Hoard";
const PRIORITY = { low: "low", medium: "normal", high: "high" };

const backends = {
  platform: () => process.platform,
  /** Runs the PowerShell of a toast: ({ command, args, timeoutMs }) => { code }; null is the family's own runner. */
  runner: null,
  hub: (type, data) => family.emit(type, data),
  /** The hub's notification facet ({ notify, hubAvailable }); null is the family client. */
  notifyHub: null,
};
const initial = { ...backends };

/** Tests swap the platform, the PowerShell runner, the hub emitter and the hub's notification facet. */
export function setNotifyBackends(patch) {
  Object.assign(backends, patch);
}
export function resetNotifyBackends() {
  Object.assign(backends, initial);
}

/** Show one Windows toast; resolves "" on success or a short reason. */
export async function showToast(title, body, url = "") {
  const done = await family.showToast(title, body, url || null, { appName: APP_NAME, platform: backends.platform(), runner: backends.runner });
  if (done.ok) return "";
  return done.unsupported ? "no es Windows" : String(done.error || "error");
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

/** The person is told through the hub (quiet hours, spheres, phone, ntfy) and, when the hub is not there, by a toast on this computer. */
const router = () => family.notifyRouter({
  via: () => getSetting("notify.via", "auto"),
  ownSend: async (title, body, o) => {
    const reason = await showToast(title, body, o.url);
    return reason === "" ? { ok: true } : { ok: false, error: reason };
  },
  app: "ledger",
  hub: backends.notifyHub,
});

/** Deliver a list of new notifications: every one to the family bus, then the person is told, condensed. */
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
  for (const item of loud.slice(0, MAX_TOASTS)) toasts.push({ ids: [item.id], title: item.title, body: item.body, priority: PRIORITY[item.severity] || "normal", url: item.url, dedupeKey: item.dedupe_key });
  const rest = [...loud.slice(MAX_TOASTS), ...quiet];
  if (rest.length === 1) toasts.push({ ids: [rest[0].id], title: rest[0].title, body: rest[0].body, priority: PRIORITY[rest[0].severity] || "low", url: rest[0].url, dedupeKey: rest[0].dedupe_key });
  else if (rest.length > 1) toasts.push({ ids: rest.map((i) => i.id), title: APP_NAME, body: `${rest.length} avisos nuevos: ${rest.slice(0, 3).map((i) => i.title).join(" · ")}${rest.length > 3 ? "…" : ""}`, priority: "low", url: "", dedupeKey: `ledger:summary:${rest.map((i) => i.id).join(",")}`.slice(0, 200) });
  const out = router();
  for (const t of toasts) {
    const res = await out.send(t.title, t.body, { priority: t.priority, url: t.url, group: "ledger", dedupeKey: t.dedupeKey });
    // `toast`: the person was told (true) or why not; `via`: through the hub or by a toast here; `held`: the hub kept it back on purpose
    for (const id of t.ids) setDelivered(id, { toast: res.ok ? true : (res.why || "failed"), via: res.via, ...(res.held ? { held: res.held } : {}) });
  }
}

export async function flushBatch() {
  const items = batch || [];
  batch = null;
  await deliver(items);
  return items.length;
}
