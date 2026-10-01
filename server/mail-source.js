// Reads mail through the account configured in Faustus: the password never
// leaves Faustus. server/mail/faustus_mail.py runs with Faustus's own Python
// inside the Faustus folder; this module finds that folder and that Python,
// sends one JSON request on stdin and takes the last JSON line of stdout.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getSetting } from "./db.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const HELPER = path.join(HERE, "mail", "faustus_mail.py");
export const TIMEOUT_MS = 180_000;
const STATUS_TTL_MS = 300_000;
const STATUS_FAIL_TTL_MS = 30_000;

export const PYTHON_CANDIDATES = [
  "venv/Scripts/python.exe", ".venv/Scripts/python.exe", "venv/bin/python", ".venv/bin/python",
];

/** Default runner: spawn, feed stdin, collect stdout. Resolves { stdout, stderr, code, timedOut }. */
export function spawnRunner({ command, args, input, cwd, env, timeoutMs }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      resolve({ stdout: "", stderr: String(error.message || error), code: null, timedOut: false, spawnError: error.code || "spawn" });
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const finish = (extra) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, code: null, timedOut, ...extra });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch { /* already gone */ }
      finish({});
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString("utf8")).slice(-2000); });
    child.on("error", (error) => finish({ spawnError: error.code || "spawn" }));
    child.on("close", (code) => finish({ code }));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const clean = (value) => String(value ?? "").trim();

/**
 * Faustus mail source. Everything that touches the outside is injectable:
 * `runner` (the process), `getSetting` (settings table), `env`, `clock`,
 * and `roots` (the folder next to the app that is checked when nothing is
 * configured).
 */
export function createMailSource({ runner = spawnRunner, settings = getSetting, env = process.env, clock = Date.now,
  roots = [path.resolve(HERE, "..", "..", "faustus"), path.resolve(HERE, "..", "..", "..", "faustus")] } = {}) {
  let cachedStatus = null;

  function faustusDir() {
    const configured = [settings("mail.faustus_dir", ""), env.LEDGER_FAUSTUS_DIR, env.FAUSTUS_DIR].map(clean).filter(Boolean);
    const candidates = configured.length ? configured : roots;
    for (const candidate of candidates) {
      const resolved = path.resolve(candidate);
      if (isFile(path.join(resolved, "mcp_servers", "email_server.py"))) return resolved;
    }
    return null;
  }

  function pythonOf(root) {
    for (const rel of PYTHON_CANDIDATES) {
      const full = path.join(root, rel);
      if (isFile(full)) return full;
    }
    return null;
  }

  async function call(request, timeoutMs = TIMEOUT_MS) {
    const root = faustusDir();
    if (!root) return { ok: false, error: "No se encuentra la carpeta de Faustus (indícala en Ajustes → Correo)." };
    const python = pythonOf(root);
    if (!python) return { ok: false, error: "Faustus no tiene un entorno venv con Python." };
    const owner = clean(settings("mail.faustus_owner", ""));
    const body = owner ? { ...request, owner } : request;
    const childEnv = { ...env, PYTHONIOENCODING: "utf-8" };
    for (const key of Object.keys(childEnv)) if (key.startsWith("LEDGER_")) delete childEnv[key];
    let done;
    try {
      done = await runner({ command: python, args: [HELPER, root], input: JSON.stringify(body), cwd: root, env: childEnv, timeoutMs });
    } catch (error) {
      return { ok: false, error: `Ayudante de correo: ${error?.code || error?.name || "error"}` };
    }
    if (done?.timedOut) return { ok: false, error: "La lectura del correo ha tardado demasiado." };
    if (done?.spawnError) return { ok: false, error: `Ayudante de correo: ${done.spawnError}` };
    const lines = String(done?.stdout || "").split(/\r?\n/).filter((line) => line.trim().startsWith("{"));
    let answer = null;
    try { answer = lines.length ? JSON.parse(lines[lines.length - 1]) : null; } catch { answer = null; }
    if (!answer || typeof answer !== "object" || !("ok" in answer)) {
      return { ok: false, error: `Ayudante de correo: salida inesperada (código ${done?.code ?? "?"}).` };
    }
    return answer;
  }

  async function status({ refresh = false } = {}) {
    const key = `${faustusDir() || ""}|${clean(settings("mail.faustus_owner", ""))}`;
    const hit = cachedStatus;
    if (hit && !refresh && hit.key === key && clock() - hit.at < (hit.answer.ok ? STATUS_TTL_MS : STATUS_FAIL_TTL_MS)) return hit.answer;
    const answer = await call({ action: "status" }, 60_000);
    answer.faustus_dir = faustusDir() || "";
    cachedStatus = { at: clock(), key, answer };
    return answer;
  }

  /** Scan request carrying the caller's own search words (see faustus_mail.py). */
  const scan = ({ since_days, limit = 300, skip = [], query = "", gmail_query = "", subject_terms = [] }) =>
    call({ action: "scan", since_days, max: limit, skip, query, gmail_query, subject_terms });

  return { faustusDir, pythonOf, call, status, scan };
}

let current = null;
/** Process-wide source; tests replace it with setMailSource(fake). */
export function mailSource() {
  if (!current) current = createMailSource();
  return current;
}
export function setMailSource(source) {
  current = source;
}
