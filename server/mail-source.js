// Where payment mail comes from. One router (famMailRouter, from Hoard Link) reads it from the family hub's gateway
// when that is on and from Faustus's mail helper otherwise, by the `mail.source` setting: "auto" (hub first, helper as the
// fallback), "hub" (never falls back) or "faustus" (never asks the hub).
//
// The helper (server/mail/mail_helper.py, the family's one copy) runs with Faustus's own Python inside the Faustus folder, so
// the mail password never leaves Faustus; the runner that finds Faustus and spawns it is spawnHelperRunner. What stays here is
// what is Ledger's own: the settings it reads, the watermark it keeps, the search words it registers and how a status looks.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSetting, setSetting } from "./db.js";
import { familyApi } from "./family.js";
import { famMailRouter, faustusDir as findFaustusDir, faustusPython, spawnHelperRunner, PYTHON_CANDIDATES } from "./hoard-link.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The family's mail helper (a byte-identical copy of hoard_link/mail_helper.py). */
export const HELPER = path.join(HERE, "mail", "mail_helper.py");
export const TIMEOUT_MS = 180_000;
export const MAIL_SOURCES = ["auto", "hub", "faustus"];
export const WATERMARK_KEY = "mail.hub_since_id";
export { PYTHON_CANDIDATES };
const STATUS_TTL_MS = 300_000;
const STATUS_FAIL_TTL_MS = 30_000;
const clean = (value) => String(value ?? "").trim();

// The hub client is read at call time, so tests that swap it with setFamilyApi() are seen by an existing router.
const hubApi = {
  mailAvailable: (...a) => familyApi().mailAvailable?.(...a),
  mailRegisterInterest: (...a) => familyApi().mailRegisterInterest?.(...a),
  mailMessages: (...a) => familyApi().mailMessages?.(...a),
  mailClaim: (...a) => familyApi().mailClaim?.(...a),
};

/**
 * The mail source of the engine. Everything that touches the outside is injectable: `runHelper(action, payload, timeoutMs)`
 * (the helper), `settings` / `write` (the settings table), `env`, `clock` and `roots` (folders checked for Faustus after the
 * usual places).
 */
export function createMailSource({ runHelper = null, settings = getSetting, write = setSetting, env = process.env, clock = Date.now,
  roots = [], discovery = {}, hub = hubApi, spawnFn } = {}) {
  let cachedStatus = null;
  const setting = (key, fallback = "") => settings(key, fallback);
  const faustusSetting = () => [setting("mail.faustus_dir"), env.LEDGER_FAUSTUS_DIR].map(clean).find(Boolean) || null;
  const faustusDir = () => findFaustusDir(faustusSetting, { ...discovery, env, extra: roots });
  const pythonOf = (root) => faustusPython(root, null, { env });

  const run = runHelper || spawnHelperRunner({
    helperPath: HELPER, setting: faustusSetting, owner: () => setting("mail.faustus_owner"), env, envDropPrefixes: ["LEDGER_"], discovery,
    ...(spawnFn ? { spawnFn } : {}),
  });

  const router = famMailRouter({
    runHelper: run,
    sourceGetter: () => setting("mail.source", "auto"),
    interest: (criteria) => (criteria.subject_terms?.length ? { subject_terms: [...criteria.subject_terms] } : {}),
    watermarkGet: () => Number(setting(WATERMARK_KEY, 0)) || 0,
    watermarkSet: (value) => write(WATERMARK_KEY, Number(value)),
    claimKind: "payment",
    hub,
    clock: () => clock() / 1000,
  });

  /** One request to the helper (status, scan, read, send ...), whatever the mail source setting says. */
  const call = (action, payload = {}, timeoutMs = TIMEOUT_MS) => run(action, payload, timeoutMs);

  async function status({ refresh = false } = {}) {
    const mode = await router.mode();
    const used = await router.sourceNow();
    if (used === "hub") {
      const up = await router.hubUp();
      return { ok: up, source: "hub", mode, accounts: up ? [{ account: "hub gateway" }] : [], faustus_dir: faustusDir() || "",
        ...(up ? {} : { error: "la pasarela de correo del hub no está encendida (o el hub no está en marcha)" }) };
    }
    const key = `${faustusDir() || ""}|${clean(setting("mail.faustus_owner"))}`;
    const hit = cachedStatus;
    let answer;
    if (hit && !refresh && hit.key === key && clock() - hit.at < (hit.answer.ok ? STATUS_TTL_MS : STATUS_FAIL_TTL_MS)) answer = hit.answer;
    else {
      answer = await call("status", {}, 60_000);
      answer.faustus_dir = faustusDir() || "";
      cachedStatus = { at: clock(), key, answer };
    }
    return { ...answer, source: "faustus", mode };
  }

  /**
   * Payment mail for a search. A search with a query, or looking back further than the regular window, reads from the start of
   * what the hub holds and leaves the watermark alone (`hub_last_id` null); otherwise `hub_last_id` is where the next read
   * resumes once the engine has filed the messages (`commit()`).
   */
  async function scan({ since_days, limit = 300, skip = [], query = "", gmail_query = "", subject_terms = [] }) {
    const window = Number(setting("mail.window_days", 14)) || 14;
    const stored = await router.watermark();
    const deep = Boolean(query) || (Number(since_days) > window && stored > 0);
    const answer = await router.scanEx({ since_days, limit, skip, query, gmail_query, subject_terms, deep, skip_own: true });
    if (!answer.ok) return { ok: false, error: answer.error || "la lectura del correo ha fallado", source: answer.source };
    return { ok: true, error: "", source: answer.source, accounts: answer.accounts || [], messages: answer.messages || [],
      hub_last_id: answer.source === "hub" ? answer.pending_since ?? null : null };
  }

  return {
    router, faustusDir, pythonOf, call, status, scan,
    /** The messages are filed: the hub watermark of the last scan moves. */
    commit: () => router.commit(),
    /** Say which record a hub message became ("payment", ref = the movement). Messages from the helper have no hub id. */
    claim: (hubId, ref) => (hubId ? router.claim([{ hub_id: hubId }], ref) : Promise.resolve()),
    /** Register the search words with the hub again at the next scan (or now with `terms`). */
    forgetInterest: () => router.forgetInterest(),
    registerInterest: (terms, { force = true } = {}) => router.ensureInterest({ subject_terms: terms }, { force }),
  };
}

let current = null;
/** Process-wide source (the hub's gateway or the Faustus helper, by mail.source); tests replace it with setMailSource(fake). */
export function mailSource() {
  if (!current) current = createMailSource();
  return current;
}
export function setMailSource(source) {
  current = source;
}

/** The mail settings or the search words changed: the hub learns them again at the next scan. */
export const forgetInterest = () => { try { current?.forgetInterest?.(); } catch { /* nothing registered yet */ } };

// Claiming does not depend on which source read the message: the hub id says it came from the gateway.
const claimer = famMailRouter({ hub: hubApi, claimKind: "payment" });

/** After a message became a record: tell the hub it is taken (kind "payment"). Never throws. */
export async function claimMail(hubId, ref) {
  if (!hubId) return;
  try { await claimer.claim([{ hub_id: hubId }], ref); } catch { /* the claim is a hint */ }
}
