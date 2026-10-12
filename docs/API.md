# Local API and shared assistant

The native API and its tool catalog are listed in `README.md`. The MCP stdio bridge exposes 47 tools and proxies calls to the running server; it does not open the database itself.

The shared assistant uses `GET /api/copilot/info`, `GET /api/copilot/panel.js`, `GET /api/copilot/launcher.js` and `POST /api/copilot/proxy`. Identity and credentials are supplied by the server. Sessions, conversation history and model requests live in Faustus, with the global LLM service configured on Sparks.

The Faustus icon opens the panel. Context contains the current page, month, filters, real objects read from the native API, and complete unsaved form fields. New or missing objects do not invent references. Turn completion refreshes the open view in place. Account, entry, subscription and scenario-line edits send changed fields only and retain typed fields during refreshes. This preserves updates to other fields made through the API or MCP.

The existing native entry API accepts notes up to 2000 characters. Longer unsaved notes are still passed intact as form context; saving follows the existing entry validation contract.
