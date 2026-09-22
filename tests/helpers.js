// Shared test helpers: temp data dir and an in-process server on a free port.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app.js";
import { close } from "../server/db.js";

export function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ledgers-hoard-test-"));
}

export async function bootServer() {
  const dataDir = tempDir();
  const { app, token } = createApp({ dataDir, dataDirConfigured: true, serveStatic: false });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body, headers = {}) => {
    const response = await fetch(base + url, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  };
  const agent = (name, args) => call("POST", "/api/agent/call", { name, arguments: args }, { Authorization: `Bearer ${token}` });
  const stop = async () => {
    await new Promise((resolve) => server.close(resolve));
    close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  };
  return { base, dataDir, token, call, agent, stop };
}

export const SAMPLE_CSV = `Fecha;Concepto;Importe;Saldo
03/09/2026;COMPRA SUPERMERCADO EJEMPLO;-42,10;1.957,90
05/09/2026;NOMINA EMPRESA FICTICIA S.L.;1.500,00;3.457,90
07/09/2026;"RECIBO LUZ ""HOGAR"" SEPTIEMBRE";-63,25;3.394,65
`;
