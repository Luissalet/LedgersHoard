// Payment mail through the family hub's mail gateway, shaped like the answer of the Faustus helper, and the router that
// picks between the two by the `mail.source` setting: "auto" (the hub when its gateway is on, else the helper), "hub" or
// "faustus". The hub reads the inbox once for the whole family; Ledger registers the words it searches, reads what matches
// after a stored watermark and feeds it to the same parsing and recording code as the helper's output.
import { getSetting, setSetting } from "./db.js";
import { familyApi } from "./family.js";

export const MAIL_SOURCES = ["auto", "hub", "faustus"];
export const WATERMARK_KEY = "mail.hub_since_id";
const PAGE = 100;
const REGISTER_EVERY_MS = 6 * 3600 * 1000;

let registeredAt = 0;
/** Register again at the next scan (the mail settings or the search words changed). */
export const forgetInterest = () => { registeredAt = 0; };

export const sourceMode = (settings = getSetting) => {
  const value = String(settings("mail.source", "auto") || "auto").toLowerCase();
  return MAIL_SOURCES.includes(value) ? value : "auto";
};

async function hubUp() {
  try { return Boolean(await familyApi().mailAvailable?.()); } catch { return false; }
}

/** Tell the hub which mail Ledger wants. Cached for six hours; `force` registers now. */
export async function registerInterest(terms, { force = false, clock = Date.now } = {}) {
  if (!force && clock() - registeredAt < REGISTER_EVERY_MS) return { ok: true, cached: true };
  try {
    const res = await familyApi().mailRegisterInterest?.({ subject_terms: [...terms] });
    if (res?.ok) registeredAt = clock();
    return res || { ok: false, error: "no answer" };
  } catch (error) {
    return { ok: false, error: String(error?.message || error).slice(0, 120) };
  }
}

const matchesQuery = (m, words) => {
  const hay = [m.subject, m.text, m.from_address, m.from_name].map((x) => String(x || "")).join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
};

/**
 * Messages after the stored watermark. A search with a query, or looking back further than the regular window, reads from the
 * start of what the hub holds and leaves the watermark alone (`hub_last_id` null); the engine stores `hub_last_id` once the
 * messages are filed.
 */
export async function hubScan({ since_days, limit = 300, skip = [], query = "" }, { settings = getSetting, clock = Date.now } = {}) {
  const api = familyApi();
  const window = Number(settings("mail.window_days", 14)) || 14;
  const stored = Number(settings(WATERMARK_KEY, 0)) || 0;
  // looking further back than usual (or searching) re-reads from the start and leaves the watermark alone; with no watermark yet
  // there is nothing to leave alone, so the first read sets it
  const deep = Boolean(query) || (Number(since_days) > window && stored > 0);
  const watermark = deep ? 0 : stored;
  const sinceTs = deep || watermark === 0 ? clock() / 1000 - Number(since_days) * 86400 : 0;
  const known = new Set(skip);
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  const messages = [];
  let last = watermark;
  let gotAny = false;
  while (messages.length < limit) {
    const page = await api.mailMessages({ sinceId: last, limit: PAGE, full: true });
    if (!page?.ok) return { ok: false, error: String(page?.error || "el hub no respondió").slice(0, 200) };
    const rows = page.messages || [];
    if (!rows.length) { last = Math.max(last, Number(page.last_id) || last); break; }
    gotAny = true;
    for (const m of rows) {
      last = Math.max(last, Number(m.id) || 0);
      if (known.has(String(m.message_id || ""))) continue;
      if (sinceTs && m.ts && Number(m.ts) < sinceTs) continue;
      if (words.length && !matchesQuery(m, words)) continue;
      if (m.from_self) continue;
      messages.push({ message_id: m.message_id, subject: m.subject || "", from_name: m.from_name || "", from_address: m.from_address || "", text: m.text || "",
        ts: m.ts, account: m.account || m.source || "", hub_id: String(m.id ?? "") });
      if (messages.length >= limit) break;
    }
    if (rows.length < PAGE) break;
  }
  return { ok: true, source: "hub", accounts: [{ account: "hub gateway", matches: messages.length }], messages,
    hub_last_id: deep ? null : (gotAny || last !== watermark ? last : null) };
}

/**
 * The mail source of the engine: the hub's gateway or the Faustus helper (`own`). `own` keeps its interface, so the engine and
 * the tests see the same object either way.
 */
export function createRoutedSource({ own, settings = getSetting, offline = () => false } = {}) {
  const now = async () => {
    const mode = sourceMode(settings);
    if (offline() || mode === "faustus") return "faustus";
    if (mode === "hub") return "hub";
    return (await hubUp()) ? "hub" : "faustus";
  };
  return {
    ...own,
    own,
    sourceNow: now,
    async status(options) {
      const mode = sourceMode(settings);
      const used = await now();
      if (used === "hub") {
        const up = await hubUp();
        return { ok: up, source: "hub", mode, accounts: up ? [{ account: "hub gateway" }] : [], faustus_dir: own.faustusDir?.() || "",
          ...(up ? {} : { error: "la pasarela de correo del hub no está encendida (o el hub no está en marcha)" }) };
      }
      return { ...(await own.status(options)), source: "faustus", mode };
    },
    async scan(request) {
      if ((await now()) === "hub") {
        await registerInterest(request.subject_terms || []);
        const answer = await hubScan(request, { settings });
        if (answer.ok || sourceMode(settings) === "hub") return answer;
      }
      return own.scan(request);
    },
  };
}

export const storeWatermark = (id) => { if (id !== null && id !== undefined && Number.isFinite(Number(id))) setSetting(WATERMARK_KEY, Number(id)); };

/** After a message became a record: tell the hub it is taken (kind "payment", ref = the movement). Never throws. */
export async function claimMail(hubId, ref) {
  if (!hubId) return;
  try { await familyApi().mailClaim?.([Number(hubId)], "payment", ref); } catch { /* the claim is a hint */ }
}
