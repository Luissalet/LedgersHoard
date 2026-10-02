// Entry point: pick a port, open the database and serve API + UI on 127.0.0.1.
import { createApp, resolveDataDir } from "./app.js";
import { findAvailablePort, validPort } from "./hoard-commons/server.js";
import { runServer } from "./hoard-commons/express.js";
import { close as closeDb } from "./db.js";
import { setAppUrl } from "./family.js";

const PREFERRED_PORT = validPort(process.env.LEDGER_PORT || process.env.PORT, 5180);
const PORT = process.env.PORT_STRICT === "1" ? PREFERRED_PORT : await findAvailablePort(PREFERRED_PORT, { span: 100 });
const dataDir = resolveDataDir();
let scheduler = null;

try {
  const { port } = await runServer({
    service: "Ledger's Hoard",
    port: PORT,
    createApp: () => {
      const made = createApp({
        dataDir, dataDirConfigured: !!process.env.LEDGER_DATA_DIR, startScheduler: process.env.LEDGER_MAIL_SCHEDULER !== "0",
      });
      scheduler = made.scheduler;
      return made.app;
    },
    // SIGINT / SIGTERM: stop the mail scan, then close the database (WAL checkpoint) before the process ends
    onShutdown: () => { scheduler?.stop(); closeDb(); },
  });
  setAppUrl(`http://127.0.0.1:${port}`);
  if (port !== PREFERRED_PORT) console.log(`Puerto ${PREFERRED_PORT} ocupado; usando ${port}.`);
  console.log(`Ledger's Hoard en http://127.0.0.1:${port} · datos en ${dataDir}`);
} catch (error) {
  console.error(`No se pudo iniciar Ledger's Hoard: ${error.message}`);
  scheduler?.stop();
  closeDb();
  process.exitCode = 1;
}
