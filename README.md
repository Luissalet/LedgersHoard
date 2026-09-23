# Ledger's Hoard

Local-first household ledger: accounts, categorised entries, monthly budgets, reports and bank CSV imports, stored in a single SQLite file on your own computer and exposed to an assistant through MCP.

Spanish version: [`README.es.md`](README.es.md).

## Run

Requires Node.js 22.13 or later (it uses the built-in `node:sqlite`). No native modules, no Docker.

```sh
npm install
npm run build
npm start          # http://127.0.0.1:5180
```

`npm run open` starts the server and opens the browser on Windows. `npm run dev` runs the API (`node --watch`) and Vite together with the `/api` proxy configured automatically.

The server binds to `127.0.0.1` only. If port 5180 is busy it walks up to the next free port and prints the address; set `PORT_STRICT=1` to fail instead.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `LEDGER_PORT` / `PORT` | Preferred port (default `5180`). |
| `PORT_STRICT=1` | Do not fall back to another port. |
| `LEDGER_DATA_DIR` | Data folder (default `<repo>/data`, gitignored). Contains `ledgers-hoard.db` and `mcp-token`. |
| `LEDGER_ALLOWED_HOSTS` | Extra host names accepted behind a tunnel (see below). |
| `LEDGER_URL` | MCP bridge: base URL of the running app (default `http://127.0.0.1:5180`). Must be local. |
| `LEDGER_TOKEN_FILE` / `LEDGER_TOKEN` | MCP bridge: where to read the bearer token (default `<data dir>/mcp-token`). |

### Access from your phone (behind a tunnel)

The server binds 127.0.0.1 and only answers requests whose `Host` is `localhost`, `127.0.0.1` or `[::1]`. To reach it from your phone through a tunnel that fronts the app (a private mesh network, a reverse proxy), list the extra host names in `LEDGER_ALLOWED_HOSTS`, comma-separated, exact names or `*.suffix`: `LEDGER_ALLOWED_HOSTS=my-pc.example,*.ts.net`. Port and letter case are ignored, and the `Origin` of API calls must resolve to one of those hosts too (any scheme or port). Cross-site *fetches* are still refused; opening the app from another page (a link, a bookmarklet, the share sheet) is a normal navigation and works.

Once opened through the tunnel, the browser offers to install it (PWA).

## What it does

- **Resumen** — month picker, income / expense / net / total balance tiles, budget bars per category (over budget in the danger colour, with a written "Superado" chip), recent entries and account balances.
- **Movimientos** — filterable table (date range, account, category, free text) with a quick-add row at the top (Enter saves, Escape cancels), inline edit, delete with confirmation, and a transfer form to move money between accounts.
- **Cuentas** — cash, bank, card, savings or other; currency per account; opening balance; archive instead of delete when there are entries.
- **Categorías** — expense and income categories with optional parent, colour and a monthly budget editable in place. A Spanish default set (Comida, Casa, Transporte, Ocio, Salud, Suscripciones, Ropa, Regalos, Otros gastos; Nómina, Otros ingresos) is seeded the first time the table is empty.
- **Importar** — paste or choose a bank CSV. Delimiter (`;`, `,`, tab), header row, dates (`DD/MM/YYYY`, `YYYY-MM-DD`, `DD-MM-YYYY`), Spanish decimal comma and separate debit/credit columns are detected; the mapping can be corrected with selects; the preview shows the first 20 rows and how many are duplicates; commit reports added / skipped.
- **Informes** — 12-month income vs expense bars and expense-by-category donut, both inline SVG with a table view.
- **Ajustes** — currency symbol; data folder and version shown read-only.

All money is stored as integer cents. User input like `12,50`, `12.5`, `-3`, `1.234,56` or `1,234.56` is parsed by `shared/money.js` (`parseAmount`), which the UI, the API and the tools all use.

Transfers are two entries linked by `transfer_id`; they change balances but are excluded from income/expense totals and budgets.

## API

All routes are JSON, validated with zod, and answer errors as `{ "error": "…" }` with a proper status code.

| Route | Purpose |
| --- | --- |
| `GET /api/health` | `{ service: "ledgers-hoard", version, dataDirConfigured }`, no auth. |
| `GET /api/state` | UI bootstrap: accounts with balances, categories, settings, data dir. |
| `GET/POST/PATCH/DELETE /api/accounts[/:id]` | Accounts CRUD (delete only when unused). |
| `GET/POST/PATCH/DELETE /api/categories[/:id]` | Categories CRUD. |
| `GET/POST/PATCH/DELETE /api/entries[/:id]` | Entries; `GET` takes `from`, `to`, `account`, `category` (or `none`), `text`, `tag`, `source`, `limit`, `offset`, `order`. `POST`/`PATCH` accept `amount` (text) or `amount_cents`. |
| `POST /api/transfers` | `{ from_account_id, to_account_id, amount \| amount_cents, date?, note? }`. |
| `GET /api/summary?month=YYYY-MM` | Income, expense, net, per-category spent vs budget, per-account balance. |
| `GET /api/budget?month=` | Budget status with a one-line verdict. |
| `GET /api/reports/months?from=&to=` | Per-month income / expense / net (defaults to the last 12 months). |
| `POST /api/imports/preview` | `{ csv, mapping?, account_id? }` → columns, guessed mapping, first 20 rows, duplicate count. |
| `POST /api/imports/commit` | Same body plus `account_id` (required) → inserts with `import_hash = sha1(date\|amount\|description\|account)`; duplicates skipped. |
| `GET /api/imports` | Import history. |
| `PUT /api/settings` | `{ currency_symbol }`. |
| `GET /api/agent/tools` | Tool catalogue (name, description, JSON schema, annotations) and the assistant instructions. |
| `POST /api/agent/call` | `{ name, arguments }` with `Authorization: Bearer <token>`; used by the MCP bridge. |

## Connect an assistant (MCP)

`server/mcp.js` is a stdio MCP server that proxies every call to the running app, so only one process ever opens the database. Keep the app running while the assistant works.

```json
{
  "command": "node",
  "args": ["C:/path/to/ledgers-hoard/server/mcp.js"],
  "env": { "LEDGER_URL": "http://127.0.0.1:5180", "LEDGER_TOKEN_FILE": "C:/path/to/ledgers-hoard/data/mcp-token" }
}
```

`faustus-plugin.json` describes the app for Faustus (health check, launch hint and the MCP command with placeholders).

Tools (17):

| Tool | Purpose |
| --- | --- |
| `list_accounts` | Accounts with current balance. |
| `upsert_account` | Create an account or update the one with the same name (case/accent-insensitive): type, currency (default EUR), opening balance as text, archived. |
| `list_categories` | Categories with budgets, optionally by kind. |
| `add_entry` | Record a movement: amount as text, kind `expense` / `income` / `auto`, account and category by name (fuzzy, accent-insensitive; the only account is used automatically; category created only with `create_category: true`). Returns the stored entry and the resolved account/category. |
| `list_entries` | Filter by dates, account, category, text, tag; limit ≤ 200. |
| `search_entries` | Free text over counterparty, note, tags and category. |
| `summary` | Monthly totals, per category with budget, per account. |
| `budget_status` | Budget vs spent per category with `over` flags and a human verdict. |
| `months_report` | Per-month income / expense / net between two months. |
| `balance` | Balance of one account (or all) at a date. |
| `update_entry` | Edit an entry's fields. |
| `delete_entry` | Delete an entry (destructive; removes both halves of a transfer). |
| `upsert_category` | Create or update a category by name. |
| `set_budget` | Set or clear a monthly budget. |
| `import_csv_preview` | Analyse CSV text: columns, guessed mapping, sample rows, duplicates. |
| `import_csv_commit` | Import into an account with dedupe by hash (safe to repeat). |
| `transfer` | Move money between two accounts. |

Every description ends with a `Sinónimos:` line of Spanish words. Ambiguous account or category names return `candidates` so the assistant can ask instead of guessing.

## Data and limits

- `data/ledgers-hoard.db` — SQLite in WAL mode, schema migrations in `server/db.js` (`schema_version` table).
- `data/mcp-token` — 32 random bytes written at every start; never committed.
- Requests are accepted only from `localhost` / `127.0.0.1` origins; cross-site requests are rejected.
- CSV bodies up to 10 MB; `list_entries` returns at most 200 rows per call for tools and 500 for the UI.
- No network calls are made by the server.

## Verification

```sh
npm test        # node --test tests/*.test.js — parser, CSV, reports, HTTP API, agent auth and tools
npm run build   # vite build → dist/
```

Tests use temporary data directories and never touch `data/`.

## Layout

```
server/   app.js (Express), index.js (boot), db.js, accounts.js, categories.js, entries.js,
          reports.js, csv.js, imports.js, dates.js, money.js, routes.js, agent-tools.js,
          agent-routes.js, mcp.js, port.js
shared/   money.js (parseAmount / formatCents, used by server and client)
client/   React 19 + Vite + Tailwind v4 (pages: Resumen, Movimientos, Cuentas, Categorías, Importar, Informes, Ajustes)
scripts/  launch.mjs, dev.mjs
tests/    node:test suites
```

License: MIT (see `LICENSE`).
