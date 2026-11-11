// Cobros: the notice ladder (day 1, 7, 14), never twice for the same step, the
// escalation to the user with the client's history, the reconciliation of a
// payment found in the ledger and the REST routes.
import test from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "./helpers.js";
import { setDraftWriter } from "../server/receivables.js";
import { setNotifyBackends, resetNotifyBackends } from "../server/notifications.js";

const quiet = () => setNotifyBackends({ hub: async () => {}, notifyHub: null, platform: () => "linux" });

/** An invoice due `daysAgo` days before `today`. */
const invoice = (over = {}) => ({
  client: "Talleres Ejemplo", email: "cliente@ejemplo.com", concept: "Revisión de la furgoneta",
  amount: "1.250,00", issued_date: "2026-10-01", due_date: "2026-10-20", reference: "2026-014",
  payment_terms: "Transferencia a ES00 0000 0000 0000 0000 0000", ...over,
});

test("the ladder: day 1 a reminder, day 7 a firmer one, day 14 the user and never twice", async () => {
  const s = await bootServer();
  quiet();
  setDraftWriter(async () => null);          // no model in tests: the templates
  try {
    const made = await s.call("POST", "/api/receivables", invoice());
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const id = made.body.id;
    assert.ok(["pending", "overdue"].includes(made.body.status), made.body.status);

    // the day it is due: nothing yet
    const due = await s.call("POST", "/api/receivables/check", { today: "2026-10-20" });
    assert.equal(due.status, 200);
    assert.equal(due.body.drafts.length, 0);

    // day 1: a plain reminder
    const day1 = await s.call("POST", "/api/receivables/check", { today: "2026-10-21" });
    assert.equal(day1.body.drafts.length, 1);
    assert.equal(day1.body.drafts[0].notice.step, 1);
    assert.match(day1.body.drafts[0].notice.body, /1 día/);
    assert.match(day1.body.drafts[0].notice.body, /1\.250,00/);

    // running it again the same day adds nothing
    const again = await s.call("POST", "/api/receivables/check", { today: "2026-10-21" });
    assert.equal(again.body.drafts.length, 0, "no second notice for the same step");

    // day 7: the firmer one, with the amount, the reference and how to pay
    const day7 = await s.call("POST", "/api/receivables/check", { today: "2026-10-27" });
    assert.equal(day7.body.drafts.length, 1);
    const firm = day7.body.drafts[0].notice;
    assert.equal(firm.step, 2);
    assert.match(firm.body, /2026-014/);
    assert.match(firm.body, /1\.250,00/);
    assert.match(firm.body, /Transferencia a ES00/);
    assert.match(firm.body, /7 días/);

    // day 14: no mail to the client, a notification to the user with the whole history
    const day14 = await s.call("POST", "/api/receivables/check", { today: "2026-11-03" });
    assert.equal(day14.body.drafts.length, 0, "the client is not written to at day 14");
    assert.equal(day14.body.escalated.length, 1);
    assert.equal(day14.body.escalated[0].days, 14);
    assert.equal(day14.body.escalated[0].history.length, 1);
    assert.equal(day14.body.escalated[0].history[0].notices.length, 3);

    const notes = await s.call("GET", "/api/mail/notifications?kind=receivables.escalated");
    assert.equal(notes.body.notifications.length, 1);
    assert.match(notes.body.notifications[0].title, /Talleres Ejemplo/);
    assert.match(notes.body.notifications[0].body, /14 días/);

    // and the escalation is not repeated either
    const day15 = await s.call("POST", "/api/receivables/check", { today: "2026-11-04" });
    assert.equal(day15.body.escalated.length, 0);

    // the invoice detail carries the timeline
    const detail = await s.call("GET", `/api/receivables/${id}`);
    assert.equal(detail.body.notices.length, 3);
    assert.deepEqual(detail.body.notices.map((n) => n.step), [1, 2, 3]);
    assert.equal(detail.body.receivable.status, "overdue");
    assert.ok(detail.body.receivable.days_overdue > 0);
  } finally {
    setDraftWriter(null);
    resetNotifyBackends();
    await s.stop();
  }
});

test("the model rewrites the text only when it keeps the amount and the reference", async () => {
  const s = await bootServer();
  quiet();
  try {
    await s.call("POST", "/api/receivables", invoice());
    setDraftWriter(async ({ template }) => `${template.body}\n\n(reescrito)`);
    const kept = await s.call("POST", "/api/receivables/check", { today: "2026-10-21" });
    assert.equal(kept.body.drafts[0].source, "modelo");
    assert.match(kept.body.drafts[0].notice.body, /reescrito/);

    // a rewrite that loses the amount falls back to the template
    await s.call("POST", "/api/receivables", invoice({ client: "Otra Casa", reference: "2026-015", due_date: "2026-10-20" }));
    setDraftWriter(async () => "Págame, por favor.");
    const lost = await s.call("POST", "/api/receivables/check", { today: "2026-10-21" });
    const other = lost.body.drafts.find((d) => d.receivable.client === "Otra Casa");
    assert.equal(other.source, "plantilla");
    assert.match(other.notice.body, /1\.250,00/);
  } finally {
    setDraftWriter(null);
    resetNotifyBackends();
    await s.stop();
  }
});

test("a paused invoice is never chased and a paid one stops the drafts", async () => {
  const s = await bootServer();
  quiet();
  setDraftWriter(async () => null);
  try {
    const a = (await s.call("POST", "/api/receivables", invoice({ client: "En Pausa" }))).body;
    const b = (await s.call("POST", "/api/receivables", invoice({ client: "Cobrada", reference: "2026-016" }))).body;
    await s.call("POST", `/api/receivables/${a.id}/pause`, { paused: true });
    await s.call("POST", `/api/receivables/${b.id}/paid`, { date: "2026-10-21" });

    const run = await s.call("POST", "/api/receivables/check", { today: "2026-10-21" });
    assert.equal(run.body.drafts.length, 0);
    assert.equal(run.body.escalated.length, 0);

    const list = await s.call("GET", "/api/receivables");
    const paused = list.body.receivables.find((r) => r.id === a.id);
    const paid = list.body.receivables.find((r) => r.id === b.id);
    assert.equal(paused.status, "paused");
    assert.equal(paid.status, "paid");
    assert.equal(paid.paid_date, "2026-10-21");
    assert.equal(list.body.summary.counts.paused, 1);
    assert.equal(list.body.summary.counts.overdue, 0);
  } finally {
    setDraftWriter(null);
    resetNotifyBackends();
    await s.stop();
  }
});

test("a payment in the ledger that matches an invoice is proposed, and accepting it marks it paid with a thank-you draft", async () => {
  const s = await bootServer();
  quiet();
  setDraftWriter(async () => null);
  try {
    const account = (await s.call("POST", "/api/accounts", { name: "Banco", type: "bank", opening_balance: 0 })).body;
    const inv = (await s.call("POST", "/api/receivables", invoice())).body;

    // an income with the same amount and the client's name
    const entry = await s.call("POST", "/api/entries", {
      date: "2026-10-22", amount: "1.250,00", account_id: account.id, counterparty: "Talleres Ejemplo", note: "Factura 2026-014",
    });
    assert.equal(entry.status, 201, JSON.stringify(entry.body));

    const sweep = await s.call("POST", "/api/receivables/sweep", {});
    assert.equal(sweep.status, 200);
    assert.equal(sweep.body.proposals.length, 1);
    const proposal = sweep.body.proposals[0];
    assert.equal(proposal.receivable_id, inv.id);

    // nothing is marked paid by itself
    assert.equal((await s.call("GET", `/api/receivables/${inv.id}`)).body.receivable.status, "overdue");

    const accepted = await s.call("POST", `/api/receivables/proposals/${proposal.id}/accept`, {});
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.equal(accepted.body.receivable.status, "paid");
    assert.equal(accepted.body.receivable.paid_date, "2026-10-22");
    assert.equal(accepted.body.receivable.paid_entry_id, entry.body.id);
    assert.equal(accepted.body.notice.step, 0);
    assert.equal(accepted.body.notice.state, "draft");
    assert.match(accepted.body.notice.body, /He recibido el pago de 1\.250,00/);

    // the same payment is not proposed twice
    const again = await s.call("POST", "/api/receivables/sweep", {});
    assert.equal(again.body.proposals.length, 0);
  } finally {
    setDraftWriter(null);
    resetNotifyBackends();
    await s.stop();
  }
});

test("a payment with another amount or another payer is not proposed", async () => {
  const s = await bootServer();
  quiet();
  try {
    const account = (await s.call("POST", "/api/accounts", { name: "Banco", type: "bank", opening_balance: 0 })).body;
    await s.call("POST", "/api/receivables", invoice());
    await s.call("POST", "/api/entries", { date: "2026-10-22", amount: "1.200,00", account_id: account.id, counterparty: "Talleres Ejemplo" });
    await s.call("POST", "/api/entries", { date: "2026-10-22", amount: "1.250,00", account_id: account.id, counterparty: "Panadería Otra" });
    const sweep = await s.call("POST", "/api/receivables/sweep", {});
    assert.equal(sweep.body.proposals.length, 0);
  } finally {
    resetNotifyBackends();
    await s.stop();
  }
});

test("routes: create, list with filters, edit, drafts, discard, send without mail and delete", async () => {
  const s = await bootServer();
  quiet();
  setDraftWriter(async () => null);
  try {
    const bad = await s.call("POST", "/api/receivables", { client: "Sin importe", due_date: "2026-10-20" });
    assert.equal(bad.status, 400);

    const created = await s.call("POST", "/api/receivables", invoice());
    assert.equal(created.status, 201);
    assert.equal(created.body.amount_cents, 125000);
    assert.equal(created.body.amount, "1.250,00 €");

    const list = await s.call("GET", "/api/receivables?status=overdue");
    assert.equal(list.body.receivables.length, 1);
    assert.equal(list.body.summary.overdue_cents, 125000);
    assert.equal((await s.call("GET", "/api/receivables?status=paid")).body.receivables.length, 0);

    const edited = await s.call("PATCH", `/api/receivables/${created.body.id}`, { amount: "1.300,00", concept: "Revisión y frenos" });
    assert.equal(edited.body.amount_cents, 130000);
    assert.equal(edited.body.concept, "Revisión y frenos");

    await s.call("POST", "/api/receivables/check", { today: "2026-10-21" });
    const drafts = await s.call("GET", "/api/receivables/drafts");
    assert.equal(drafts.body.drafts.length, 1);
    const draft = drafts.body.drafts[0];

    const changed = await s.call("PATCH", `/api/receivables/notices/${draft.id}`, { body: "Texto corregido a mano." });
    assert.equal(changed.body.body, "Texto corregido a mano.");

    // no mail source in tests: the text comes back to copy and nothing is marked sent
    const sent = await s.call("POST", `/api/receivables/notices/${draft.id}/send`, {});
    assert.equal(sent.status, 200);
    assert.equal(sent.body.sent, false);
    assert.equal(sent.body.copy.to, "cliente@ejemplo.com");
    assert.equal(sent.body.notice.state, "draft");

    const discarded = await s.call("POST", `/api/receivables/notices/${draft.id}/discard`, {});
    assert.equal(discarded.body.state, "discarded");
    assert.equal((await s.call("GET", "/api/receivables/drafts")).body.drafts.length, 0);

    const removed = await s.call("DELETE", `/api/receivables/${created.body.id}`);
    assert.equal(removed.body.ok, true);
    assert.equal((await s.call("GET", "/api/receivables")).body.receivables.length, 0);
    assert.equal((await s.call("GET", `/api/receivables/${created.body.id}`)).status, 404);
  } finally {
    setDraftWriter(null);
    resetNotifyBackends();
    await s.stop();
  }
});

test("the tools are in the catalogue and the settings keep the deadlines in order", async () => {
  const s = await bootServer();
  quiet();
  try {
    const tools = await s.call("GET", "/api/agent/tools", null, { Authorization: `Bearer ${s.token}` });
    const names = (tools.body.tools || tools.body).map((t) => t.name);
    for (const name of ["receivables_list", "receivable_add", "receivable_update", "receivables_check", "receivable_drafts", "receivable_send", "receivable_mark_paid"]) {
      assert.ok(names.includes(name), `${name} missing`);
    }

    const added = await s.agent("receivable_add", { client: "Cliente MCP", amount: "300", issued_date: "2026-10-01", due_date: "2026-10-20", reference: "MCP-1" });
    assert.equal(added.status, 200, JSON.stringify(added.body));
    assert.equal(added.body.receivable.amount_cents, 30000);

    const listed = await s.agent("receivables_list", {});
    assert.equal(listed.body.receivables.length, 1);

    const checked = await s.agent("receivables_check", { today: "2026-10-21" });
    assert.equal(checked.body.drafts.length, 1);

    const drafts = await s.agent("receivable_drafts", {});
    assert.equal(drafts.body.drafts.length, 1);

    const paid = await s.agent("receivable_mark_paid", { ref: "MCP-1", date: "2026-10-22" });
    assert.equal(paid.body.receivable.status, "paid");

    const bad = await s.call("PUT", "/api/receivables/settings", { step1_days: 10, step2_days: 5 });
    assert.equal(bad.status, 400);
    const good = await s.call("PUT", "/api/receivables/settings", { step1_days: 2, step2_days: 9, escalate_days: 21, tone: "formal" });
    assert.equal(good.body.step1_days, 2);
    assert.equal(good.body.tone, "formal");
  } finally {
    resetNotifyBackends();
    await s.stop();
  }
});