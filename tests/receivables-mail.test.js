import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { bootServer } from "./helpers.js";
import * as rec from "../server/receivables.js";
import * as family from "../server/hoard-link.js";
import { setNotifyBackends, resetNotifyBackends } from "../server/notifications.js";

async function setup() {
  const s = await bootServer();
  setNotifyBackends({ hub: async () => {}, notifyHub: null, platform: () => "linux" });
  rec.updateReceivableSettings({ use_model: false });
  const calls = [];
  let answer = { ok: true, state: "sent", sent: true, message_id: "<test@example.com>" };
  const gateway = http.createServer(async (request, response) => {
    let body = "";
    for await (const part of request) body += part;
    if (request.url === "/api/mail/compose") calls.push({ path: request.url, auth: request.headers.authorization, body: JSON.parse(body || "{}") });
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(answer));
  });
  await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  family.configure({ app: "ledger", dataDir: s.dataDir, hub: `http://127.0.0.1:${gateway.address().port}` });
  const make = async (email = "me@example.com") => {
    const invoice = rec.createReceivable({ client: "Cliente de prueba", email, amount_cents: 12000,
      issued_date: "2026-10-01", due_date: "2026-10-20", reference: "QA-MAIL" });
    const run = await rec.checkReceivables({ today: "2026-10-21" });
    return { invoice, run, notice: run.drafts[0].notice };
  };
  return { ...s, calls, make, reply: (next) => { answer = next; }, cleanup: async () => {
    resetNotifyBackends();
    await new Promise((resolve) => gateway.close(resolve));
    await s.stop();
  } };
}

test("manual send reaches mail service; draft and unknown replies never mark sent", async () => {
  const s = await setup();
  try {
    assert.equal(rec.receivableSettings().auto_send, false);
    const { notice } = await s.make();
    assert.equal(s.calls.length, 0, "draft generation never sends by default");
    for (const state of ["draft", "unknown"]) {
      s.reply({ ok: state === "draft", state, sent: false, error: state === "unknown" ? "lost reply" : "" });
      const result = await s.call("POST", `/api/receivables/notices/${notice.id}/send`, {});
      assert.equal(result.body.sent, false);
      assert.equal(result.body.notice.state, "draft");
      assert.equal(result.body.copy.to, "me@example.com");
    }
    s.reply({ ok: true, state: "sent", sent: true, message_id: "<receipt@example.com>" });
    const sent = await s.agent("receivable_send", { notice_id: notice.id });
    assert.equal(sent.body.sent, true);
    assert.equal(sent.body.notice.state, "sent");
    assert.ok(sent.body.notice.sent_at);
    assert.equal(sent.body.delivery.message_id, "<receipt@example.com>");
    assert.equal(s.calls.length, 3);
    assert.deepEqual(s.calls[2].body.to, ["me@example.com"]);
    assert.equal(s.calls[2].body.mode, "send");
    assert.equal(s.calls[2].path, "/api/mail/compose");
    assert.equal(s.calls[2].auth, `Bearer ${s.token}`);
    assert.equal((await s.call("POST", `/api/receivables/notices/${notice.id}/send`, {})).status, 409);
    assert.equal(s.calls.length, 3, "no second transmission");
  } finally { await s.cleanup(); }
});

test("automatic sending is opt-in, only new notices, no resend on next pass, no client escalation mail", async () => {
  const s = await setup();
  try {
    rec.updateReceivableSettings({ auto_send: true });
    const { run } = await s.make();
    assert.equal(run.drafts[0].delivery.sent, true);
    assert.equal(run.drafts[0].notice.state, "sent");
    await rec.checkReceivables({ today: "2026-10-21" });
    await rec.checkReceivables({ today: "2026-11-04" });
    assert.equal(s.calls.length, 1);
  } finally { await s.cleanup(); }
});

test("missing email under automatic sending stays a draft without aborting the check", async () => {
  const s = await setup();
  try {
    rec.updateReceivableSettings({ auto_send: true });
    const { run } = await s.make("");
    assert.equal(run.drafts[0].delivery.sent, false);
    assert.match(run.drafts[0].notice.error, /correo/);
    assert.equal(s.calls.length, 0);
  } finally { await s.cleanup(); }
});

test("double click transmits once and a discarded or paused reminder cannot send", async () => {
  const s = await setup();
  try {
    const { notice, invoice } = await s.make();
    let finish;
    const pending = rec.sendNotice(notice.id, { sendMail: () => new Promise((resolve) => { finish = resolve; }) });
    await assert.rejects(rec.sendNotice(notice.id), /está enviando/);
    assert.throws(() => rec.discardNotice(notice.id), /está enviando/);
    finish({ ok: false, error: "offline" });
    await pending;
    rec.pauseReceivable(invoice.id);
    await assert.rejects(rec.sendNotice(notice.id), /pausada/);
    rec.pauseReceivable(invoice.id, false);
    rec.discardNotice(notice.id);
    await assert.rejects(rec.sendNotice(notice.id), /borrador pendiente/);
    assert.equal(s.calls.length, 0);
  } finally { await s.cleanup(); }
});
