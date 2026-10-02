// REST routes the pages use for the family features (the tools are in family-tools.js).
import { z } from "zod";
import { forecastMonth } from "./outlook.js";
import { attachDoc, detachDoc, resolveDocUrl } from "./tx-links.js";
import { addSplit, removeSplit, splitSettle, splitsBalance, splitsOf } from "./splits.js";
import { yearReport } from "./reports.js";
import { thisMonth } from "./dates.js";

const monthQuery = z.string().regex(/^\d{4}-\d{2}$/).optional();

// Express 4 does not catch a rejected promise: hand it to the error handler.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function installFamilyRoutes(app) {
  app.get("/api/forecast/month", (req, res) => res.json(forecastMonth({ month: monthQuery.parse(req.query.month) || thisMonth() })));
  app.get("/api/reports/year", (req, res) => res.json(yearReport(req.query.year ? Number(req.query.year) : new Date().getFullYear())));

  app.post("/api/entries/:id/docs", (req, res) => res.status(201).json(attachDoc(req.params.id, req.body?.doc_ref, req.body?.label)));
  app.delete("/api/entries/:id/docs", (req, res) => res.json(detachDoc(req.params.id, String(req.query.ref || ""))));
  app.get("/api/doc-link", wrap(async (req, res) => res.json(await resolveDocUrl(String(req.query.ref || "")))));

  app.get("/api/entries/:id/splits", (req, res) => res.json({ splits: splitsOf(req.params.id) }));
  app.delete("/api/entries/:id/splits", (req, res) => res.json(removeSplit(req.params.id, String(req.query.person || ""))));
  app.post("/api/splits", wrap(async (req, res) => res.status(201).json(await addSplit(req.body || {}))));
  app.get("/api/splits/balance", wrap(async (req, res) => res.json(await splitsBalance({ person: req.query.person ? String(req.query.person) : undefined }))));
  app.post("/api/splits/settle", wrap(async (req, res) => res.status(201).json(await splitSettle(req.body || {}))));
}
