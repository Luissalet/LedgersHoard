// REST routes for the Correo and Suscripciones pages: /api/mail/* and
// /api/subscriptions/*. Message ids travel in the body or the query string
// (they contain <, > and @), never in the path.
import { z } from "zod";
import * as engine from "./mail-engine.js";
import { mailSettings, updateMailSettings } from "./mail-settings.js";
import { mailSource } from "./mail-source.js";
import { listNotifications } from "./notifications.js";
import * as subs from "./subscriptions.js";
import { parseAmount } from "./money.js";
import { thisMonth } from "./dates.js";

/** Express 4 does not catch rejected promises: hand them to the shared error handler. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const notFound = (res) => res.status(404).json({ error: "No existe." });
const messageId = z.object({ message_id: z.string().min(1).max(400) });

function withCents(body) {
  const out = { ...(body || {}) };
  if (out.amount_cents == null && out.amount !== undefined && out.amount !== null && out.amount !== "") {
    const cents = parseAmount(out.amount);
    if (cents === null) throw Object.assign(new Error("Importe no válido."), { status: 400 });
    out.amount_cents = Math.abs(cents);
  }
  delete out.amount;
  return out;
}

export function installMailRoutes(app) {
  app.get("/api/mail/status", wrap(async (req, res) => {
    res.json(await engine.mailStatus({ withSource: req.query.source === "1", refresh: req.query.refresh === "1" }));
  }));
  app.get("/api/mail/source", wrap(async (req, res) => {
    const status = await mailSource().status({ refresh: req.query.refresh === "1" });
    res.json(status);
  }));
  app.get("/api/mail/settings", (req, res) => res.json(mailSettings()));
  app.put("/api/mail/settings", (req, res) => res.json(updateMailSettings(req.body || {})));

  app.post("/api/mail/scan", wrap(async (req, res) => {
    const body = z.object({ since_days: z.number().int().min(1).max(365).optional(), query: z.string().max(200).optional() }).parse(req.body || {});
    const run = await engine.scanMail({ ...body, trigger: "manual" });
    res.status(run.busy ? 409 : 200).json(run);
  }));
  app.get("/api/mail/messages", (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 300);
    res.json({ messages: engine.listMail({ state: req.query.state || null, kind: req.query.kind || null, limit }) });
  });
  app.get("/api/mail/review", (req, res) => res.json({ messages: engine.reviewQueue() }));
  app.get("/api/mail/recorded", (req, res) => res.json({ month: req.query.month || thisMonth(), messages: engine.recordedInMonth(req.query.month || thisMonth()) }));
  app.get("/api/mail/spending", (req, res) => res.json(engine.mailSpending(req.query.month || thisMonth())));
  app.get("/api/mail/runs", (req, res) => res.json({ runs: engine.listRuns() }));
  app.get("/api/mail/notifications", (req, res) => res.json({ notifications: listNotifications({ limit: Math.min(Number(req.query.limit) || 50, 200), kind: req.query.kind || null }) }));

  app.post("/api/mail/accept", wrap(async (req, res) => {
    const { message_id, ...overrides } = { ...messageId.passthrough().parse(req.body || {}) };
    res.json(await engine.acceptMail(message_id, overrides));
  }));
  app.post("/api/mail/ignore", (req, res) => res.json({ mail: engine.ignoreMail(messageId.parse(req.body || {}).message_id) }));
  app.post("/api/mail/undo", (req, res) => {
    const { message_id, confirm } = messageId.extend({ confirm: z.boolean().optional() }).parse(req.body || {});
    res.json(engine.undoMail(message_id, { confirm }));
  });
  app.post("/api/mail/reset", (req, res) => {
    const body = z.object({ confirm: z.boolean().optional(), delete_entries: z.boolean().optional() }).parse(req.body || {});
    res.json(engine.resetMail(body));
  });
  app.post("/api/mail/paste", wrap(async (req, res) => {
    const body = z.object({ subject: z.string().max(400).default(""), text: z.string().min(1).max(200_000), from: z.string().max(300).default(""), date: z.string().nullable().optional() }).parse(req.body || {});
    res.json(await engine.pasteMail(body));
  }));

  // Subscriptions
  app.get("/api/subscriptions", (req, res) => res.json(subs.summary({ days: Number(req.query.days) || 30 })));
  app.get("/api/subscriptions/upcoming", (req, res) => res.json({ upcoming: subs.upcoming({ days: Math.min(Number(req.query.days) || 30, 365) }) }));
  app.post("/api/subscriptions", (req, res) => res.status(201).json(subs.present(subs.createSubscription(withCents(req.body)))));
  app.post("/api/subscriptions/detect", (req, res) => res.json({ created: subs.syncFromEntries().map(subs.present) }));
  app.patch("/api/subscriptions/:id", (req, res) => {
    const out = subs.updateSubscription(req.params.id, withCents(req.body));
    return out ? res.json(subs.present(out)) : notFound(res);
  });
  app.delete("/api/subscriptions/:id", (req, res) => res.json({ ok: subs.deleteSubscription(req.params.id) }));
}
