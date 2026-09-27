// MCP stdio bridge. It never opens the database: every call is proxied to the
// running app (POST /api/agent/call) with the token from <DATA_DIR>/mcp-token.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TOOLS, AGENT_INSTRUCTIONS } from "./agent-tools.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { version } = createRequire(import.meta.url)("../package.json");
const base = process.env.LEDGER_URL || `http://127.0.0.1:${process.env.LEDGER_PORT || process.env.PORT || 5180}`;
const parsed = new URL(base);
if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) || parsed.protocol !== "http:")
  throw Error("El puente MCP solo se conecta al servidor local.");
const tokenFile = process.env.LEDGER_TOKEN_FILE
  || path.join(process.env.LEDGER_DATA_DIR || path.join(root, "data"), "mcp-token");

const server = new McpServer({ name: "ledgers-hoard", version }, { instructions: AGENT_INSTRUCTIONS });
for (const tool of TOOLS)
  server.registerTool(
    tool.name,
    { description: tool.description, inputSchema: tool.schema, annotations: tool.annotations },
    async (args) => {
      let requestStarted = false;
      let bodyReceived = false;
      try {
        const token = process.env.LEDGER_TOKEN || fs.readFileSync(tokenFile, "utf8").trim();
        requestStarted = true;
        const response = await fetch(new URL("/api/agent/call", base), {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ name: tool.name, arguments: args }),
          signal: AbortSignal.timeout(90000),
        });
        const body = await response.json();
        bodyReceived = true;
        if (!response.ok) throw Object.assign(Error(body.error || `Error ${response.status}`), { candidates: body.candidates });
        return { content: [{ type: "text", text: JSON.stringify(body) }] };
      } catch (e) {
        const offline = e.code === "ENOENT" || e.message === "fetch failed";
        const uncertain = requestStarted && !bodyReceived && !tool.annotations.readOnlyHint;
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({
            error: uncertain
              ? "No se recibió la respuesta. El movimiento puede haberse aplicado: consulta el estado antes de repetirlo."
              : offline ? "Abre Ledger's Hoard (npm start) para acceder a tus datos." : e.message,
            ...(uncertain ? { status: "outcome_unknown", outcome_unknown: true,
              reconcile_action: "read_current_state_before_retry" } : {}),
            ...(e.candidates ? { candidates: e.candidates } : {}),
          }) }],
        };
      }
    },
  );
await server.connect(new StdioServerTransport());
