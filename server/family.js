// Ledger on the family hub: calls to other apps (People, Mercator), references between records and the app's own address.
// The hub client is injectable so tests never touch the network; nothing here throws.
import * as hub from "./hoard-link.js";

let api = { ...hub };
let base = "";

/** Tests swap the hub client (an object with the functions of hoard-link.js that the app uses). */
export const setFamilyApi = (replacement) => { api = replacement ? { ...hub, ...replacement } : { ...hub }; };
export const familyApi = () => ({ ...api, appInfo: api.appInfo || appInfo });

/** The address the app answers on (set once the server listens); "" in tests. */
export const setAppUrl = (url) => { base = String(url || "").replace(/\/+$/, ""); };
export const appUrl = () => base;
/** A link into the app's own pages, "" while the address is unknown. */
export const appLink = (hash) => (base ? `${base}/${hash}` : "");

/**
 * Call a tool of another app through the hub and flatten the answer: { ok: true, result } or { ok: false, error }.
 * The hub says whether the call reached the app; the tool may still answer { ok: false }.
 */
export async function callApp(app, tool, args = {}, { timeoutMs = 15000 } = {}) {
  let res;
  try {
    res = await api.call(app, tool, args, { timeoutMs });
  } catch (error) {
    return { ok: false, error: String(error?.message || error).slice(0, 200) };
  }
  if (!res || res.ok === false) return { ok: false, error: String(res?.error || res?.result?.error || "the hub did not answer").slice(0, 200) };
  const result = res.result;
  if (result && typeof result === "object" && result.ok === false) return { ok: false, error: String(result.error || "the app refused").slice(0, 200) };
  return { ok: true, result };
}

/** Record a reference between two records; hints only, errors are dropped. */
export function linkRefs(from, to, rel, labels = {}) {
  try {
    const out = api.refsLink?.(from, to, rel, labels);
    if (out && typeof out.catch === "function") out.catch(() => {});
  } catch { /* references are hints */ }
}

export const txRef = (id) => `hoard://ledger/tx/${id}`;

/** The hub's record of an app ({ url, state, ... }), or null. GET /api/apps/<id> answers without a token. */
export async function appInfo(app, { timeoutMs = 2000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${hub.status().hub}/api/apps/${encodeURIComponent(app)}`, { signal: ctl.signal });
    return res.ok ? await res.json() : null;
  } catch { return null; } finally { clearTimeout(timer); }
}
