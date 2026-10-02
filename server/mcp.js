// MCP stdio bridge. It never opens the database: every call is proxied to the
// running app (POST /api/agent/call) with the token from <DATA_DIR>/mcp-token.
// The bridge itself (timeouts, outcome_unknown, error envelope) is the family's createBridge.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TOOLS, AGENT_INSTRUCTIONS } from "./agent-tools.js";
import { createBridge } from "./hoard-commons/express.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { version } = createRequire(import.meta.url)("../package.json");
const base = process.env.LEDGER_URL || `http://127.0.0.1:${process.env.LEDGER_PORT || process.env.PORT || 5180}`;
const tokenFile = process.env.LEDGER_TOKEN_FILE
  || path.join(process.env.LEDGER_DATA_DIR || path.join(root, "data"), "mcp-token");

const bridge = createBridge({
  app: "ledger", service: "ledgers-hoard", version, McpServer, StdioServerTransport, tools: TOOLS, instructions: AGENT_INSTRUCTIONS,
  baseUrl: base, tokenFile, token: () => process.env.LEDGER_TOKEN || "",
  messages: {
    title: "Ledger's Hoard",
    offline: "Abre Ledger's Hoard (npm start) para acceder a tus datos.",
    outcomeUnknown: "No se recibió la respuesta. El movimiento puede haberse aplicado: consulta el estado antes de repetirlo.",
  },
});
await bridge.start();
