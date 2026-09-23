// REST routes for the UI. Every body is zod-validated in the domain modules;
// errors bubble to the shared error handler in app.js as { error }.
import { z } from "zod";
import * as accounts from "./accounts.js";
import * as categories from "./categories.js";
import * as entries from "./entries.js";
import * as reports from "./reports.js";
import { previewImport, commitImport, listImports } from "./imports.js";
import { parseAmount } from "./money.js";
import { thisMonth, isMonth, addMonths } from "./dates.js";
import { getSetting, setSetting, dataDir } from "./db.js";
import { manifest, serviceWorker } from "./manifest.js";

const notFound = (res) => res.status(404).json({ error: "No existe." });
const monthQuery = z.string().regex(/^\d{4}-\d{2}$/).optional();
const settingsInput = z.object({ currency_symbol: z.string().trim().min(1).max(5).optional() });

/** The UI sends amounts as text ("12,50"); the API also accepts amount_cents. */
function withCents(input) {
  const body = { ...(input || {}) };
  if (body.amount_cents == null && body.amount !== undefined && body.amount !== null) {
    const cents = parseAmount(body.amount);
    if (cents === null) throw Object.assign(new Error("Importe no válido."), { status: 400 });
    body.amount_cents = cents;
  }
  delete body.amount;
  return body;
}

export function getSettings() {
  return { currency_symbol: "€", ...getSetting("settings", {}) };
}

export function installRoutes(app, { version, dataDirConfigured }) {
  app.get("/api/health", (req, res) => {
    res.json({ service: "ledgers-hoard", version, dataDirConfigured });
  });

  app.get("/api/state", (req, res) => {
    res.json({
      accounts: accounts.accountBalances(),
      categories: categories.listCategories(),
      settings: getSettings(),
      dataDir: dataDir(),
      month: thisMonth(),
      version,
    });
  });

  app.put("/api/settings", (req, res) => {
    const patch = settingsInput.parse(req.body || {});
    res.json(setSetting("settings", { ...getSettings(), ...patch }));
  });

  // Accounts
  app.get("/api/accounts", (req, res) => res.json(accounts.accountBalances()));
  app.post("/api/accounts", (req, res) => res.status(201).json(accounts.createAccount(req.body || {})));
  app.patch("/api/accounts/:id", (req, res) => {
    const out = accounts.updateAccount(req.params.id, req.body || {});
    return out ? res.json(out) : notFound(res);
  });
  app.delete("/api/accounts/:id", (req, res) => res.json({ ok: accounts.deleteAccount(req.params.id) }));

  // Categories
  app.get("/api/categories", (req, res) => res.json(categories.listCategories()));
  app.post("/api/categories", (req, res) => res.status(201).json(categories.createCategory(req.body || {})));
  app.patch("/api/categories/:id", (req, res) => {
    const out = categories.updateCategory(req.params.id, req.body || {});
    return out ? res.json(out) : notFound(res);
  });
  app.delete("/api/categories/:id", (req, res) => res.json({ ok: categories.deleteCategory(req.params.id) }));

  // Entries
  app.get("/api/entries", (req, res) => res.json(entries.listEntries(req.query)));
  app.get("/api/entries/:id", (req, res) => {
    const out = entries.getEntry(req.params.id);
    return out ? res.json(out) : notFound(res);
  });
  app.post("/api/entries", (req, res) => res.status(201).json(entries.createEntry(withCents(req.body))));
  app.patch("/api/entries/:id", (req, res) => {
    const out = entries.updateEntry(req.params.id, withCents(req.body));
    return out ? res.json(out) : notFound(res);
  });
  app.delete("/api/entries/:id", (req, res) => res.json({ ok: entries.deleteEntry(req.params.id) }));
  app.post("/api/transfers", (req, res) => {
    const body = withCents(req.body);
    if (typeof body.amount_cents === "number") body.amount_cents = Math.abs(body.amount_cents);
    res.status(201).json(entries.createTransfer(body));
  });

  // Reports
  app.get("/api/summary", (req, res) => {
    const month = monthQuery.parse(req.query.month) || thisMonth();
    if (!isMonth(month)) return res.status(400).json({ error: "Mes no válido (YYYY-MM)." });
    res.json(reports.summary(month));
  });
  app.get("/api/budget", (req, res) => {
    const month = monthQuery.parse(req.query.month) || thisMonth();
    res.json(reports.budgetStatus(month));
  });
  app.get("/api/reports/months", (req, res) => {
    const to = monthQuery.parse(req.query.to) || thisMonth();
    const from = monthQuery.parse(req.query.from) || addMonths(to, -11);
    if (!isMonth(from) || !isMonth(to) || from > to) return res.status(400).json({ error: "Rango de meses no válido." });
    res.json({ from, to, months: reports.monthsReport(from, to) });
  });

  // Imports
  app.get("/api/imports", (req, res) => res.json(listImports()));
  app.post("/api/imports/preview", (req, res) => res.json(previewImport(req.body || {})));
  app.post("/api/imports/commit", (req, res) => res.status(201).json(commitImport(req.body || {})));

  // PWA manifest and service worker.
  app.get("/manifest.webmanifest", (req, res) => {
    res.set("Content-Type", "application/manifest+json");
    res.send(JSON.stringify(manifest()));
  });
  app.get("/sw.js", (req, res) => {
    res.set("Content-Type", "application/javascript");
    res.set("Service-Worker-Allowed", "/");
    res.send(serviceWorker());
  });
}
