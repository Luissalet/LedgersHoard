# Ledger's Hoard

A local household ledger: accounts, categorised entries, budgets, reports, bank imports, payments read from your mail, shared expenses and a month-end forecast, stored in one SQLite file on your own computer.

Spanish version: [`README.es.md`](README.es.md).

## What it is

Ledger's Hoard is a small web app (Express + React) that keeps your household money in a single local SQLite database. Everything is stored as integer cents, nothing leaves the machine, and the same data is exposed to an assistant through MCP, so you can use the interface, ask Faustus, or both.

It is one app of the Hoard family and works on its own. When the family hub or Faustus is running it also reads payment mail, sends collection notices, notifies you and appears on the family agenda. The interface is in Spanish.

## What it does

**Entries and accounts**
- Accounts (cash, bank, card, savings, other) with a currency each and an opening balance; archived instead of deleted when they have entries.
- Expense and income categories with optional parent, colour and an editable monthly budget; a Spanish default set is seeded on first run.
- Entries table with filters (dates, account, category, free text, partial tag), quick-add row, inline edit, delete with confirmation, tag editor, "create a similar entry" and incremental loading with totals per currency.
- Transfers between accounts (two linked entries): they change balances but are excluded from income, expense and budgets.
- Find a payment by exact amount within five days of a date, to check whether an invoice was paid.
- Attach documents of other apps to a movement (`hoard://app/kind/id` references shown as chips that open in the owning app).

**Import**
- Bank CSV: delimiter, header row, date formats, decimal comma and separate debit/credit columns are detected; the mapping can be corrected, the preview shows duplicates, and repeating an import is safe.
- OFX/QFX statements.
- A bank row that matches a movement already recorded from mail or typed by hand joins it instead of creating a second entry.

**Reports and planning**
- Summary: month picker, income / expense / net / balance tiles, budget bars per category, account balances, what the mail recorded this month and a projected balance at month end with its lines.
- Month comparison against the previous month and the three-month average, total and per category.
- Reports: 12-month income vs expense, expense by category, yearly report by month and category, and detection of recurring charges.
- "Unusual charges": a repeated charge within days, a spike against the merchant's median, an extra charge from a monthly merchant, a large first charge. Signals to review, not proof of fraud.
- Forecast: named what-if scenarios with one-time, monthly or quarterly assumptions, compared against recorded balances for 3-24 months, or against each other.
- Budget and renewal alerts, charged-after-cancelling alerts, and a daily check of overdue invoices.

**Mail**
- Reads the mail account connected to Faustus (or the hub's mail gateway) and records receipts, card notices, bills, shop orders and refunds as expenses on the charge date, with merchant, amount, order number and confidence.
- Low-confidence mail goes to a review queue (accept, ignore, undo) with possible duplicates pointed out; the same message or order is never recorded twice.
- Paste a receipt that is not in the inbox.
- Mail text is treated as untrusted data and stored only as a short snippet.

**Subscriptions**
- Found in mail or in repeated charges, with monthly and yearly cost per currency, price history, next charge, trial end, cancel / pause, and upcoming charges.

**Shared expenses**
- Split an expense you paid among people (by share, amount or equally); per-person balances and paybacks, applied to the oldest open share first.

**Cobros (invoices you issue)**
- Invoices with client, concept, amount, due date, reference and payment instructions.
- A notice ladder: a plain reminder on day 1, a firmer one on day 7, and an internal notification on day 14. Drafts are editable and sent through the family mail service on request; automatic sending is off by default.
- Payments in the ledger that look like a pending invoice are proposed for you to accept or dismiss.

**Income from sales**
- Books the income of a sales batch from the family's sales app, one entry per currency and day, idempotent.

## Run it

Requires Node.js 22.13 or later (it uses the built-in `node:sqlite`). No native modules, no Docker.

```sh
npm install
npm run build
npm start          # http://127.0.0.1:5180
```

`npm run open` starts the server and opens the browser on Windows. `npm run dev` runs the API and Vite together. The server binds to `127.0.0.1`; if the port is busy it takes the next free one unless `PORT_STRICT=1`.

| Variable | Purpose |
| --- | --- |
| `LEDGER_PORT` / `PORT` | Preferred port (default `5180`). |
| `PORT_STRICT=1` | Do not fall back to another port. |
| `LEDGER_DATA_DIR` | Data folder (default `./data`, gitignored). |
| `LEDGER_ALLOWED_HOSTS` | Extra host names accepted behind a tunnel, comma-separated, exact or `*.suffix`. |
| `LEDGER_FAUSTUS_DIR` / `FAUSTUS_DIR` | Faustus folder used to read mail (also settable in Ajustes). |
| `LEDGER_MAIL_SCHEDULER=0` | Do not start the background mail reader. |
| `LEDGER_ALERTS=0` | Turn off the hourly alert check. |
| `LEDGER_URL`, `LEDGER_TOKEN_FILE` / `LEDGER_TOKEN` | MCP bridge: app URL and bearer token location. |
| `HOARD_FAUSTUS_URL` | Faustus address for the copilot (default `http://127.0.0.1:7000`). |
| `HOARD_COPILOT=0` | Disable the Faustus copilot button and routes. |

Behind a private tunnel, list the host names in `LEDGER_ALLOWED_HOSTS`; the browser then offers to install the app as a PWA.

## Connect an assistant (MCP)

`server/mcp.js` is a stdio MCP server that proxies every call to the running app, so only one process opens the database. Keep the app running while the assistant works.

```json
{
  "command": "node",
  "args": ["C:/path/to/ledgers-hoard/server/mcp.js"],
  "env": { "LEDGER_URL": "http://127.0.0.1:5180", "LEDGER_TOKEN_FILE": "C:/path/to/ledgers-hoard/data/mcp-token" }
}
```

`faustus-plugin.json` describes the app for Faustus (health check, launch hint, MCP command). The tools, about sixty, are grouped as:

| Area | Tools |
| --- | --- |
| Accounts and categories | `list_accounts`, `upsert_account`, `list_categories`, `upsert_category`, `set_budget` |
| Entries | `add_entry`, `list_entries`, `search_entries`, `update_entry`, `delete_entry`, `transfer`, `balance`, `tx_find`, `tx_attach_doc` |
| Reports | `summary`, `budget_status`, `months_report`, `report_year`, `month_compare`, `recurring_candidates`, `spending_anomalies`, `mail_spending` |
| Forecast | `forecast_month`, `list_scenarios`, `get_scenario`, `create_scenario`, `add_scenario_line`, `update_scenario_line`, `delete_scenario_line`, `cash_forecast`, `compare_cash_forecasts` |
| CSV import | `import_csv_preview`, `import_csv_commit` |
| Mail | `mail_status`, `mail_scan`, `mail_review`, `mail_accept`, `mail_ignore`, `mail_undo`, `mail_paste`, `mail_reset` |
| Subscriptions and alerts | `subscriptions_list`, `subscription_update`, `subscriptions_upcoming`, `subscription_delete`, `alert_settings`, `ledger_notifications` |
| Shared expenses | `split_add`, `splits_balance`, `split_settle` |
| Invoices issued | `receivables_list`, `receivable_add`, `receivable_update`, `receivables_check`, `receivable_drafts`, `receivable_send`, `receivable_mark_paid` |
| Sales | `income_from_sales` |

Account and category names are matched fuzzily and accent-insensitively; ambiguous names return candidates so the assistant can ask. Destructive tools require `confirm: true`. The tool catalogue is also served at `GET /api/agent/tools`.

## Connection with Faustus and the Hoard family

- **Copilot**: every page has a floating Faustus button that opens the assistant in a side panel. The conversation lives in Faustus; this app relays it and tells the assistant which page, month, filters and open form you are looking at. When the assistant finishes a turn the page reloads its data in place without losing what you typed.
- **App Dock**: opened beside a Faustus chat, the page registers `ledger_open`, `ledger_filter` and `ledger_view` so the assistant can open records, apply filters and switch sections.
- **Hub**: mail gateway, notifications (quiet hours, phone), address book for shared expenses, and the family agenda (`GET /api/family/agenda`: subscription renewals, trial ends, expected charges, old shared debts).
- **Skills**: `faustus-plugin.json` names the family skill `household-ledger-month-close`.

All of these are optional: with the hub or Faustus away, every local feature still works and the ones that need another app say so.

## Data and security

- `data/ledgers-hoard.db`: SQLite in WAL mode with versioned migrations. `data/mcp-token`: a random token written at every start, never committed.
- Requests are accepted only from `localhost` / `127.0.0.1` hosts and origins (plus any in `LEDGER_ALLOWED_HOSTS`); cross-site requests are rejected.
- The server talks to nothing outside the machine; only the mail helper process talks to a mail server.
- Money input such as `12,50`, `1.234,56` or `1,234.56` is parsed by `shared/money.js`, which the interface, API and tools share.

## Project layout

| Path | Contents |
| --- | --- |
| `server/` | Express API, SQLite access, mail engine and parser, scheduler, receivables, reports, forecast, MCP bridge, family client |
| `server/hoard-commons/`, `server/hoard-link.js` | Vendored shared code of the Hoard family (money, dates, guard, MCP bridge); do not edit here |
| `client/` | React 19 + Vite + Tailwind v4 (Resumen, Movimientos, Cuentas, Categorías, Importar, Informes, Compartidos, Previsión, Correo, Suscripciones, Cobros, Ajustes) |
| `shared/` | Code used by both server and client (`money.js`) |
| `scripts/` | `launch.mjs`, `dev.mjs` |
| `tests/` | `node:test` suites |

```sh
npm test         # node --test tests/*.test.js
npm run build    # vite build -> dist/
```

Tests use temporary data directories and never touch `data/`.

License: MIT (see `LICENSE`).
