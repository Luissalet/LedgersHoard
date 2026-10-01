import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createMailSource, spawnRunner, HELPER } from "../server/mail-source.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ledger-faustus-"));

/** A Faustus folder with the mail module marker and a venv python of the given kind. */
function fakeFaustus(dir, { python = "venv/bin/python" } = {}) {
  fs.mkdirSync(path.join(dir, "mcp_servers"), { recursive: true });
  fs.writeFileSync(path.join(dir, "mcp_servers", "email_server.py"), "# stub\n");
  if (python) {
    fs.mkdirSync(path.dirname(path.join(dir, python)), { recursive: true });
    fs.writeFileSync(path.join(dir, python), "stub\n");
  }
  return dir;
}

const settingsOf = (values = {}) => (key, fallback) => (key in values ? values[key] : fallback);

test("finds the Faustus folder: setting, then env vars, then sibling folders; valid only with mcp_servers/email_server.py", () => {
  const configured = fakeFaustus(tmp());
  const fromEnv = fakeFaustus(tmp());
  const sibling = fakeFaustus(tmp());
  const broken = tmp();
  const make = (settings, env = {}, roots = []) => createMailSource({ settings: settingsOf(settings), env, roots, runner: async () => ({}) });
  assert.equal(make({ "mail.faustus_dir": configured }).faustusDir(), path.resolve(configured));
  assert.equal(make({}, { LEDGER_FAUSTUS_DIR: fromEnv }).faustusDir(), path.resolve(fromEnv));
  assert.equal(make({}, { FAUSTUS_DIR: fromEnv }).faustusDir(), path.resolve(fromEnv));
  assert.equal(make({}, {}, [path.join(os.tmpdir(), "nope-1"), sibling]).faustusDir(), path.resolve(sibling));
  assert.equal(make({ "mail.faustus_dir": broken }, {}, [sibling]).faustusDir(), null, "a configured folder that is not Faustus is not replaced by a guess");
  assert.equal(make({}, {}, [broken]).faustusDir(), null);
  assert.equal(make({ "mail.faustus_dir": configured }, { LEDGER_FAUSTUS_DIR: fromEnv }).faustusDir(), path.resolve(configured), "setting beats env");
});

test("finds the Python of the Faustus venv", () => {
  for (const rel of ["venv/Scripts/python.exe", ".venv/Scripts/python.exe", "venv/bin/python", ".venv/bin/python"]) {
    const dir = fakeFaustus(tmp(), { python: rel });
    const source = createMailSource({ settings: settingsOf({ "mail.faustus_dir": dir }), env: {}, runner: async () => ({}) });
    assert.equal(source.pythonOf(path.resolve(dir)), path.join(path.resolve(dir), rel));
  }
  const none = fakeFaustus(tmp(), { python: null });
  assert.equal(createMailSource({ settings: settingsOf({}), env: {}, roots: [] }).pythonOf(none), null);
});

test("runner contract: python, helper and folder as arguments, request on stdin, cwd in Faustus, owner added, hidden window", async () => {
  const dir = fakeFaustus(tmp());
  const calls = [];
  const runner = async (call) => { calls.push(call); return { stdout: 'noise line\n{"ok": true, "messages": [], "accounts": []}\n', stderr: "", code: 0 }; };
  const source = createMailSource({ settings: settingsOf({ "mail.faustus_dir": dir, "mail.faustus_owner": "luis" }), env: { LEDGER_DATA_DIR: "/secret", PATH: "/bin" }, runner });
  const out = await source.scan({ since_days: 30, skip: ["<a@b>"], query: "", gmail_query: "(recibo)", subject_terms: ["recibo"] });
  assert.equal(out.ok, true);
  const call = calls[0];
  assert.equal(call.command, path.join(path.resolve(dir), "venv/bin/python"));
  assert.deepEqual(call.args, [HELPER, path.resolve(dir)]);
  assert.equal(call.cwd, path.resolve(dir));
  assert.equal(call.timeoutMs, 180_000);
  assert.equal(call.env.PYTHONIOENCODING, "utf-8");
  assert.equal("LEDGER_DATA_DIR" in call.env, false, "the app's own variables are not passed on");
  assert.deepEqual(JSON.parse(call.input), {
    action: "scan", since_days: 30, max: 300, skip: ["<a@b>"], query: "", gmail_query: "(recibo)", subject_terms: ["recibo"], owner: "luis",
  });
  assert.ok(fs.existsSync(HELPER) && HELPER.endsWith(path.join("mail", "faustus_mail.py")));
});

test("the last JSON line of stdout is the answer; garbage, timeouts and spawn errors become readable errors", async () => {
  const dir = fakeFaustus(tmp());
  const run = (result) => createMailSource({ settings: settingsOf({ "mail.faustus_dir": dir }), env: {}, runner: async () => result }).call({ action: "status" });
  assert.equal((await run({ stdout: '{"ok": false, "error": "x"}\n{"ok": true, "n": 2}\n', code: 0 })).n, 2);
  assert.match((await run({ stdout: "Traceback...\n", code: 1 })).error, /salida inesperada \(código 1\)/);
  assert.match((await run({ stdout: "{not json}\n", code: 0 })).error, /salida inesperada/);
  assert.match((await run({ stdout: "", timedOut: true })).error, /tardado demasiado/);
  assert.match((await run({ stdout: "", spawnError: "ENOENT" })).error, /ENOENT/);
  const throwing = createMailSource({ settings: settingsOf({ "mail.faustus_dir": dir }), env: {}, runner: async () => { throw Object.assign(new Error("boom"), { code: "EACCES" }); } });
  assert.match((await throwing.call({ action: "status" })).error, /EACCES/);
  const missing = createMailSource({ settings: settingsOf({}), env: {}, roots: [], runner: async () => ({}) });
  assert.match((await missing.call({ action: "status" })).error, /carpeta de Faustus/);
  const noPython = fakeFaustus(tmp(), { python: null });
  const np = createMailSource({ settings: settingsOf({ "mail.faustus_dir": noPython }), env: {}, runner: async () => ({}) });
  assert.match((await np.call({ action: "status" })).error, /venv/);
});

test("status is cached for five minutes (a failure for thirty seconds) and refresh bypasses it", async () => {
  const dir = fakeFaustus(tmp());
  let now = 1_000_000;
  let calls = 0;
  let ok = true;
  const runner = async () => { calls++; return { stdout: JSON.stringify(ok ? { ok: true, accounts: [] } : { ok: false, error: "x" }), code: 0 }; };
  const source = createMailSource({ settings: settingsOf({ "mail.faustus_dir": dir }), env: {}, runner, clock: () => now });
  await source.status(); await source.status();
  assert.equal(calls, 1);
  now += 299_000; await source.status();
  assert.equal(calls, 1);
  now += 2_000; await source.status();
  assert.equal(calls, 2);
  await source.status({ refresh: true });
  assert.equal(calls, 3);
  ok = false; await source.status({ refresh: true });
  now += 31_000; await source.status();
  assert.equal(calls, 5, "a failed status is retried after thirty seconds");
  assert.equal((await source.status()).faustus_dir, path.resolve(dir));
});

test("default runner: spawns the venv python with stdin and reads stdout (POSIX stand-in for python)", { skip: process.platform === "win32" }, async () => {
  const dir = fakeFaustus(tmp(), { python: null });
  const python = path.join(dir, "venv", "bin", "python");
  fs.mkdirSync(path.dirname(python), { recursive: true });
  fs.writeFileSync(python, `#!/bin/sh\nread line\necho "starting"\necho "{\\"ok\\": true, \\"echo\\": $line, \\"argc\\": $#, \\"cwd\\": \\"$(pwd)\\"}"\n`, { mode: 0o755 });
  const source = createMailSource({ settings: settingsOf({ "mail.faustus_dir": dir }), env: { PATH: process.env.PATH }, roots: [] });
  const out = await source.call({ action: "status" });
  assert.equal(out.ok, true);
  assert.equal(out.echo.action, "status");
  assert.equal(out.argc, 2);
  assert.equal(fs.realpathSync(out.cwd), fs.realpathSync(dir));
  const slow = path.join(dir, "venv", "bin", "slow");
  fs.writeFileSync(slow, "#!/bin/sh\nsleep 5\n", { mode: 0o755 });
  const timeout = await spawnRunner({ command: slow, args: [], input: "{}", cwd: dir, env: process.env, timeoutMs: 150 });
  assert.equal(timeout.timedOut, true);
  const missing = await spawnRunner({ command: path.join(dir, "nope"), args: [], input: "{}", cwd: dir, env: process.env, timeoutMs: 1000 });
  assert.ok(missing.spawnError);
});

test("the helper script accepts gmail_query and subject_terms and keeps the old behaviour", { skip: spawnSync("python3", ["--version"]).error ? "python3 not available" : false }, () => {
  const probe = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("faustus_mail", ${JSON.stringify(HELPER)})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
class Conn:
    def __init__(self): self.calls = []
    def uid(self, *a):
        self.calls.append([x for x in a if x is not None]); return ("OK", [b""])
out = {}
c = Conn(); m._search(c, "imap.gmail.com", 30, "", '(recibo OR "has pagado")', None); out["gmail_custom"] = c.calls
c = Conn(); m._search(c, "imap.gmail.com", 30, "", "", None); out["gmail_default"] = c.calls
c = Conn(); m._search(c, "imap.gmail.com", 30, "from:x", "(recibo)", None); out["gmail_query_wins"] = c.calls
c = Conn(); m._search(c, "mail.example.test", 30, "", "", ["recibo", "factura"]); out["imap_terms"] = c.calls
c = Conn(); m._search(c, "mail.example.test", 30, "", "", None); out["imap_default_count"] = len(c.calls)
print(json.dumps(out))
`;
  const done = spawnSync("python3", ["-c", probe], { encoding: "utf-8" });
  assert.equal(done.status, 0, done.stderr);
  const out = JSON.parse(done.stdout.trim().split("\n").pop());
  assert.match(out.gmail_custom[0][2], /recibo OR \\"has pagado\\"/);
  assert.match(out.gmail_custom[0][2], /newer_than:30d/);
  assert.match(out.gmail_default[0][2], /seguimiento/, "the original shipping words are still the default");
  assert.match(out.gmail_query_wins[0][2], /from:x/);
  assert.equal(out.imap_terms.length, 2);
  assert.deepEqual(out.imap_terms.map((c) => c[4]), ['"recibo"', '"factura"']);
  assert.ok(out.imap_default_count > 20);
});
