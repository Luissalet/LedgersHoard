import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import { createMailSource, HELPER } from "../server/mail-source.js";
import { spawnHelperRunner } from "../server/hoard-link.js";

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
const NO_HUB = { mailAvailable: async () => false };

/** A spawn stand-in: records how it was called, answers with `stdout` on close. */
function fakeSpawn(stdout, { calls = [], code = 0 } = {}) {
  return (command, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stdin = Object.assign(new EventEmitter(), { end(data) { calls.push({ command, args, options, input: String(data) }); setImmediate(() => { child.stdout.emit("data", Buffer.from(stdout)); child.emit("close", code); }); } });
    child.kill = () => {};
    return child;
  };
}

test("finds the Faustus folder: setting, then env vars, then sibling folders; valid only with mcp_servers/email_server.py", () => {
  const configured = fakeFaustus(tmp());
  const fromEnv = fakeFaustus(tmp());
  const sibling = fakeFaustus(tmp());
  const broken = tmp();
  const make = (settings, env = {}, roots = []) => createMailSource({ settings: settingsOf(settings), env, roots, discovery: { searchParents: false, commonPaths: [] }, runHelper: async () => ({}), hub: NO_HUB });
  assert.equal(make({ "mail.faustus_dir": configured }).faustusDir(), path.resolve(configured));
  assert.equal(make({}, { LEDGER_FAUSTUS_DIR: fromEnv }).faustusDir(), path.resolve(fromEnv));
  assert.equal(make({}, { FAUSTUS_DIR: fromEnv }).faustusDir(), path.resolve(fromEnv));
  assert.equal(make({}, {}, [path.join(os.tmpdir(), "nope-1"), sibling]).faustusDir(), path.resolve(sibling));
  assert.equal(make({}, {}, [broken]).faustusDir(), null);
  assert.equal(make({ "mail.faustus_dir": configured }, { LEDGER_FAUSTUS_DIR: fromEnv }).faustusDir(), path.resolve(configured), "setting beats env");
  // the family finder keeps looking when the configured folder is not Faustus (the old one refused to guess)
  assert.equal(make({ "mail.faustus_dir": broken }, {}, [sibling]).faustusDir(), path.resolve(sibling));
});

test("finds the Python of the Faustus venv", () => {
  for (const rel of ["venv/Scripts/python.exe", ".venv/Scripts/python.exe", "venv/bin/python", ".venv/bin/python"]) {
    const dir = fakeFaustus(tmp(), { python: rel });
    const source = createMailSource({ settings: settingsOf({ "mail.faustus_dir": dir }), env: {}, runHelper: async () => ({}), hub: NO_HUB });
    assert.equal(source.pythonOf(path.resolve(dir)), path.join(path.resolve(dir), rel));
  }
  const none = fakeFaustus(tmp(), { python: null });
  assert.equal(createMailSource({ settings: settingsOf({}), env: {}, roots: [], runHelper: async () => ({}), hub: NO_HUB }).pythonOf(none), null);
});

test("runner contract: python, helper and folder as arguments, request on stdin, cwd in Faustus, owner added, hidden window", async () => {
  const dir = fakeFaustus(tmp());
  const calls = [];
  const spawnFn = fakeSpawn('noise line\n{"ok": true, "messages": [], "accounts": []}\n', { calls });
  const source = createMailSource({
    settings: settingsOf({ "mail.faustus_dir": dir, "mail.faustus_owner": "luis", "mail.source": "faustus" }), spawnFn, hub: NO_HUB,
    env: { LEDGER_DATA_DIR: "/secret", PATH: "/bin" },
  });
  const out = await source.scan({ since_days: 30, skip: ["<a@b>"], query: "", gmail_query: "(recibo)", subject_terms: ["recibo"] });
  assert.equal(out.ok, true);
  assert.equal(out.source, "faustus");
  const call = calls[0];
  assert.equal(call.command, path.join(path.resolve(dir), "venv/bin/python"));
  assert.deepEqual(call.args, [HELPER, path.resolve(dir)]);
  assert.equal(call.options.cwd, path.resolve(dir));
  assert.equal(call.options.windowsHide, true);
  assert.equal(call.options.env.PYTHONIOENCODING, "utf-8");
  assert.equal("LEDGER_DATA_DIR" in call.options.env, false, "the app's own variables are not passed on");
  const request = JSON.parse(call.input);
  assert.equal(request.action, "scan");
  assert.equal(request.owner, "luis");
  assert.equal(request.max, 300);
  assert.equal(request.since_days, 30);
  assert.deepEqual(request.skip, ["<a@b>"]);
  assert.equal(request.gmail_query, "(recibo)");
  assert.deepEqual(request.subject_terms, ["recibo"]);
  assert.ok(fs.existsSync(HELPER) && HELPER.endsWith(path.join("mail", "mail_helper.py")));
});

test("the last JSON line of stdout is the answer; garbage, timeouts and spawn errors become readable errors", async () => {
  const dir = fakeFaustus(tmp());
  const run = (stdout, code = 0) => spawnHelperRunner({ helperPath: HELPER, setting: dir, env: {}, spawnFn: fakeSpawn(stdout, { code }) })("status", {});
  assert.equal((await run('{"ok": false, "error": "x"}\n{"ok": true, "n": 2}\n')).n, 2);
  assert.match((await run("Traceback...\n", 1)).error, /exit 1/);
  assert.match((await run("{not json}\n")).error, /exit 0/);
  const missing = spawnHelperRunner({ helperPath: HELPER, setting: null, env: {}, discovery: { searchParents: false, commonPaths: [] }, spawnFn: fakeSpawn("") });
  assert.match((await missing("status", {})).error, /Faustus folder not found/);
  const noPython = fakeFaustus(tmp(), { python: null });
  assert.match((await spawnHelperRunner({ helperPath: HELPER, setting: noPython, env: {} })("status", {})).error, /venv/);
  const throwing = spawnHelperRunner({ helperPath: HELPER, setting: dir, env: {}, spawnFn: () => { throw Object.assign(new Error("boom"), { code: "EACCES" }); } });
  assert.match((await throwing("status", {})).error, /EACCES/);
  // a helper that never answers is cut at the timeout
  const hang = () => { const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stdin = Object.assign(new EventEmitter(), { end() {} }); c.kill = () => setImmediate(() => c.emit("close", null)); return c; };
  assert.match((await spawnHelperRunner({ helperPath: HELPER, setting: dir, env: {}, spawnFn: hang })("status", {}, 50)).error, /too long/);
});

test("status is cached for five minutes (a failure for thirty seconds) and refresh bypasses it", async () => {
  const dir = fakeFaustus(tmp());
  let now = 1_000_000;
  let calls = 0;
  let ok = true;
  const runHelper = async () => { calls++; return ok ? { ok: true, accounts: [] } : { ok: false, error: "x" }; };
  const source = createMailSource({ settings: settingsOf({ "mail.faustus_dir": dir, "mail.source": "faustus" }), env: {}, runHelper, clock: () => now, hub: NO_HUB });
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
  const source = createMailSource({ settings: settingsOf({ "mail.faustus_dir": dir }), env: { PATH: process.env.PATH }, roots: [], hub: NO_HUB });
  const out = await source.call("status", {});
  assert.equal(out.ok, true);
  assert.equal(out.echo.action, "status");
  assert.equal(out.argc, 2);
  assert.equal(fs.realpathSync(out.cwd), fs.realpathSync(dir));
});

test("the family helper builds the Gmail expression and the IMAP subject searches from the words it is given", { skip: spawnSync("python3", ["--version"]).error ? "python3 not available" : false }, () => {
  const probe = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("faustus_mail", ${JSON.stringify(HELPER)})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
class Conn:
    def __init__(self): self.calls = []
    def uid(self, *a):
        self.calls.append([x for x in a if x is not None]); return ("OK", [b""])
out = {}
c = Conn(); m._search(c, "imap.gmail.com", 30, "", '(recibo OR "has pagado")', [], []); out["gmail_custom"] = c.calls
c = Conn(); m._search(c, "imap.gmail.com", 30, "", "", [], []); out["gmail_default"] = c.calls
c = Conn(); m._search(c, "imap.gmail.com", 30, "from:x", "(recibo)", [], []); out["gmail_query_wins"] = c.calls
c = Conn(); m._search(c, "mail.example.test", 30, "", "", ["recibo", "factura"], []); out["imap_terms"] = c.calls
c = Conn(); m._search(c, "mail.example.test", 30, "", "", [], []); out["imap_default_count"] = len(c.calls)
print(json.dumps(out))
`;
  const done = spawnSync("python3", ["-c", probe], { encoding: "utf-8" });
  assert.equal(done.status, 0, done.stderr);
  const out = JSON.parse(done.stdout.trim().split("\n").pop());
  assert.match(out.gmail_custom[0][2], /recibo OR \\"has pagado\\"/);
  assert.match(out.gmail_custom[0][2], /newer_than:30d/);
  assert.equal(out.gmail_default.length, 0, "without any search word or query nothing is read (the old copy fell back to shipping words)");
  assert.match(out.gmail_query_wins[0][2], /from:x/);
  assert.equal(out.imap_terms.length, 2);
  assert.deepEqual(out.imap_terms.map((c) => c[4]), ['"recibo"', '"factura"']);
  assert.equal(out.imap_default_count, 0);
});
