// REST routes for the Cobros page: /api/receivables/*. Amounts travel as text
// ("1.234,56") or as amount_cents; ids in the path, notice ids too.
import { z } from "zod";
import * as rec from "./receivables.js";

/** Express 4 does not catch rejected promises: hand them to the shared error handler. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const notFound = (res) => res.status(404).json({ error: "No existe." });

/** The UI sends amounts as text; the API also accepts amount_cents. */
function withCents(body) {
  const out = { ...(body || {}) };
  if (out.amount_cents == null && out.amount !== undefined && out.amount !== null && out.amount !== "") {
    out.amount_cents = rec.amountToCents(out.amount);
  }
  delete out.amount;
  return out;
}

const listQuery = z.object({
  status: z.enum(rec.STATUSES).optional(),
  q: z.string().max(200).optional(),
  sort: z.enum(["due_date", "client", "amount", "days", "status", "issued"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
});

export function installReceivableRoutes(app) {
  app.get("/api/receivables", (req, res) => {
    const query = listQuery.parse(req.query || {});
    res.json({
      receivables: rec.listReceivables(query),
      summary: rec.receivablesSummary(),
      settings: rec.receivableSettings(),
    });
  });
  app.get("/api/receivables/settings", (req, res) => res.json(rec.receivableSettings()));
  app.put("/api/receivables/settings", (req, res) => res.json(rec.updateReceivableSettings(req.body || {})));

  app.get("/api/receivables/drafts", (req, res) => res.json({ drafts: rec.listDrafts() }));
  app.get("/api/receivables/proposals", (req, res) => res.json({ proposals: rec.listProposals() }));

  app.post("/api/receivables/check", wrap(async (req, res) => {
    const body = z.object({ today: z.string().optional(), drafts: z.boolean().optional() }).parse(req.body || {});
    const settings = rec.receivableSettings();
    const run = await rec.checkReceivables({ ...(body.today ? { today: body.today } : {}), settings, drafts: body.drafts ?? settings.auto_draft });
    res.json(run);
  }));
  app.post("/api/receivables/sweep", wrap(async (req, res) => {
    const made = rec.sweepPayments({});
    await rec.announceProposals(made);
    res.json({ proposals: made, pending: rec.listProposals() });
  }));

  app.post("/api/receivables", (req, res) => res.status(201).json(rec.present(rec.createReceivable(withCents(req.body)))));
  app.get("/api/receivables/:id", (req, res) => {
    const out = rec.receivableDetail(req.params.id);
    return out ? res.json(out) : notFound(res);
  });
  app.patch("/api/receivables/:id", (req, res) => res.json(rec.present(rec.updateReceivable(req.params.id, withCents(req.body)))));
  app.delete("/api/receivables/:id", (req, res) => res.json(rec.deleteReceivable(req.params.id)));
  app.post("/api/receivables/:id/pause", (req, res) => {
    const paused = req.body?.paused === undefined ? true : Boolean(req.body.paused);
    res.json(rec.present(rec.pauseReceivable(req.params.id, paused)));
  });
  app.post("/api/receivables/:id/paid", (req, res) => {
    const body = z.object({ date: z.string().optional(), entry_id: z.string().optional() }).parse(req.body || {});
    res.json(rec.present(rec.markPaid(req.params.id, body)));
  });

  app.patch("/api/receivables/notices/:id", (req, res) => res.json(rec.updateNotice(req.params.id, req.body || {})));
  app.post("/api/receivables/notices/:id/send", wrap(async (req, res) => res.json(await rec.sendNotice(req.params.id))));
  app.post("/api/receivables/notices/:id/discard", (req, res) => res.json(rec.discardNotice(req.params.id)));

  app.post("/api/receivables/proposals/:id/accept", wrap(async (req, res) => res.json(await rec.acceptProposal(req.params.id))));
  app.post("/api/receivables/proposals/:id/dismiss", (req, res) => res.json(rec.dismissProposal(req.params.id)));
}