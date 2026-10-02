// Builds the Express app. server/index.js boots it; tests call createApp()
// with a temporary data directory and listen on a free port.
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { init as initDb } from "./db.js";
import { seedCategories } from "./categories.js";
import { installRoutes } from "./routes.js";
import { installMailRoutes } from "./mail-routes.js";
import { createMailScheduler } from "./mail-scheduler.js";
import { TOOLS, AGENT_INSTRUCTIONS } from "./agent-tools.js";
import { installFamilyRoutes } from "./family-routes.js";
import { agendaItems } from "./agenda.js";
import { mailSource } from "./mail-source.js";
import { PAYMENT_SUBJECT_TERMS } from "./mail-engine.js";
import * as family from "./hoard-link.js";
import { z } from "zod";
import { createGuard, makeAgentRoutes, installSpa, installErrorHandlers } from "./hoard-commons/express.js";
import { readOrCreateToken, resolveDataDir as commonDataDir } from "./hoard-commons/server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { version } = require("../package.json");

export const ROOT = path.join(__dirname, "..");

export function resolveDataDir(env = process.env) {
  return commonDataDir("LEDGER", ROOT, env);
}

export function createApp({ dataDir, dataDirConfigured = false, serveStatic = true, allowedHosts = process.env.LEDGER_ALLOWED_HOSTS, startScheduler = false } = {}) {
  initDb(dataDir);
  seedCategories();
  // the token is stable across restarts, so an MCP bridge started earlier keeps working
  const token = readOrCreateToken(path.join(dataDir, "mcp-token"));
  // Hoard Link 0.4: this app on the family bus (agent.call events, calls to
  // siblings through the hub, the hoard_link block in /api/health).
  family.configure({ app: "ledger", dataDir });

  const app = express();
  app.disable("x-powered-by");
  app.use(createGuard({ allowedHosts }));
  app.use(express.json({ limit: "10mb" }));
  installRoutes(app, { version, dataDirConfigured });
  installMailRoutes(app);
  installFamilyRoutes(app);
  makeAgentRoutes({ app: "ledger", tools: TOOLS, z, token, instructions: AGENT_INSTRUCTIONS, recordCall: family.recordCall }).install(app);
  // the family agenda (the hub's Today view and calendar), answered with this app's own token; before the catch-alls below
  family.installAgenda(app, (from, to, sphere) => agendaItems(from, to, sphere));
  const DIST = path.join(ROOT, "dist");
  if (serveStatic) installSpa(app, DIST, { express }); // also answers a JSON 404 for unknown /api routes
  else app.all(/^\/api(\/.*)?$/, (req, res) => res.status(404).json({ error: "Not found.", code: "not_found" }));
  installErrorHandlers(app);
  // The mail scan runs in this process (first scan 30 s after start); tests leave it off.
  const scheduler = createMailScheduler();
  if (startScheduler) {
    scheduler.start();
    Promise.resolve(mailSource().registerInterest?.(PAYMENT_SUBJECT_TERMS, { force: true })).catch(() => {}); // tell the hub's mail gateway what Ledger reads
  }
  return { app, token, version, scheduler };
}
