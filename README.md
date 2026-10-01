# Ledger's Hoard

Local-first household ledger: accounts, categorised entries, monthly budgets, reports, bank CSV imports and payments read from your mail, stored in a single SQLite file on your own computer and exposed to an assistant through MCP.

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
| `LEDGER_FAUSTUS_DIR` / `FAUSTUS_DIR` | Faustus folder used to read mail (also settable in Ajustes; else `../faustus` or `../../faustus`). Valid when `mcp_servers/email_server.py` exists. |
| `LEDGER_MAIL_SCHEDULER=0` | Do not start the background mail reader (manual «Leer ahora» and the tools still work). |

### Access from your phone (behind a tunnel)

The server binds 127.0.0.1 and only answers requests whose `Host` is `localhost`, `127.0.0.1` or `[::1]`. To reach it from your phone through a tunnel that fronts the app (a private mesh network, a reverse proxy), list the extra host names in `LEDGER_ALLOWED_HOSTS`, comma-separated, exact names or `*.suffix`: `LEDGER_ALLOWED_HOSTS=my-pc.example,*.ts.net`. Port and letter case are ignored, and the `Origin` of API calls must resolve to one of those hosts too (any scheme or port). Cross-site *fetches* are still refused; opening the app from another page (a link, a bookmarklet, the share sheet) is a normal navigation and works.

Once opened through the tunnel, the browser offers to install it (PWA).

## What it does

- **Resumen** — month picker, income / expense / net / total balance tiles, budget bars per category (over budget in the danger colour, with a written "Superado" chip), recent entries and account balances, plus a «Del correo este mes» line with what the mail recorded.
- **Movimientos** — filterable table (date range, account, category, free text) with a quick-add row at the top (Enter saves, Escape cancels), inline edit, delete with confirmation, and a transfer form to move money between accounts.
- **Cuentas** — cash, bank, card, savings or other; currency per account; opening balance; archive instead of delete when there are entries.
- **Categorías** — expense and income categories with optional parent, colour and a monthly budget editable in place. A Spanish default set (Comida, Casa, Transporte, Ocio, Salud, Suscripciones, Ropa, Regalos, Otros gastos; Nómina, Otros ingresos) is seeded the first time the table is empty.
- **Importar** — paste or choose a bank CSV. Delimiter (`;`, `,`, tab), header row, dates (`DD/MM/YYYY`, `YYYY-MM-DD`, `DD-MM-YYYY`), Spanish decimal comma and separate debit/credit columns are detected; the mapping can be corrected with selects; the preview shows the first 20 rows and how many are duplicates; commit reports added / skipped.
- **Informes** — 12-month income vs expense bars and expense-by-category donut, both inline SVG with a table view.
- **Previsión** — save named what-if scenarios with one-time, monthly or quarterly income/expense assumptions, edit them, and compare recorded vs projected balances for 3–24 months. Observed recurring candidates can fill the assumption form for review. Transfers are already reflected in recorded balances; scenario lines never create entries. Different currencies are shown per account rather than added together.
- **Correo** — reads the mail account connected to Faustus, finds payments (receipts, «has pagado», card notices, bills with «importe a cargar», shop orders with a total, refunds) and records them as expenses on the charge date. Status card (account read, last and next scan, last error, «Leer ahora», on/off, auto-record, account for mail charges, interval, review limit in euros, toast and family-bus switches), «Apuntado desde el correo» with Deshacer, «Por revisar» with Aceptar (merchant, amount, date, account and category editable) and Ignorar, duplicates seen, recent notifications, and a box to paste a receipt that is not in the inbox.
- **Suscripciones** — subscriptions found in mail (known services, subscription words) or in repeated charges (`recurring.js`; never shops or food), with monthly and yearly cost per currency, price history, next charge, trial end, Cancelada / Pausada / Editar, upcoming charges in 30 days and the alerts raised.
- **Ajustes** — currency symbol; Faustus folder and user for the mail and «Reiniciar el correo» (start over); data folder and version shown read-only.

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
| `GET /api/reports/recurring?to=YYYY-MM&months=18` | Read-only monthly/quarterly payment candidates with dated charges and observed amount changes. |
| `GET/POST /api/scenarios`, `GET/PATCH/DELETE /api/scenarios/:id` | List, create, read, rename and delete saved scenarios. |
| `POST/PATCH/DELETE /api/scenarios/:id/lines[/:lineId]` | Add, edit and remove signed one-time or monthly assumptions. |
| `GET /api/forecast?scenario_id=&from=YYYY-MM&months=6` | Recorded and projected monthly balances by account, with the scenario lines that contributed. |
| `POST /api/imports/preview` | `{ csv, mapping?, account_id? }` → columns, guessed mapping, first 20 rows, duplicate count. |
| `POST /api/imports/commit` | Same body plus `account_id` (required) → inserts with `import_hash = sha1(date\|amount\|description\|account)`; duplicates skipped. |
| `GET /api/imports` | Import history. |
| `GET /api/mail/status?source=1` | Scan status, settings, account used, counts, last runs; `source=1` also asks Faustus which account is read. |
| `GET/PUT /api/mail/settings` | Mail and notification settings. |
| `POST /api/mail/scan` | `{ since_days?, query? }` → run summary (`409` when a scan is already running). |
| `GET /api/mail/review`, `/recorded?month=`, `/messages?state=&kind=`, `/spending?month=`, `/runs`, `/notifications` | Review queue, recorded this month, message log, spending from mail, run history, notifications. |
| `POST /api/mail/accept`, `/ignore`, `/undo`, `/paste` | Message ids go in the body: `{ message_id, account?, category?, amount?, date?, merchant? }`, `{ message_id }`, `{ message_id, confirm: true }`, `{ subject, text, from }`. |
| `GET/POST /api/subscriptions`, `GET /api/subscriptions/upcoming?days=`, `POST /api/subscriptions/detect`, `PATCH/DELETE /api/subscriptions/:id` | Subscriptions with totals, upcoming charges, detection from entries. |
| `PUT /api/settings` | `{ currency_symbol }`. |
| `GET /api/agent/tools` | Tool catalogue (name, description, JSON schema, annotations) and the assistant instructions. |
| `POST /api/agent/call` | `{ name, arguments }` with `Authorization: Bearer <token>`; used by the MCP bridge. |

## Mail: payments and subscriptions

Mail is read through Faustus: `server/mail/faustus_mail.py` runs with Faustus's own Python inside the Faustus folder and returns only the messages that match a payment search (`gmail_query` for Gmail, `subject_terms` for other IMAP servers). The password never reaches this app. The first scan covers `first_days` (62: this month and the previous one); later scans cover `window_days` (14). A scan runs 30 s after start and then every `interval_min` minutes, one at a time; the last 50 runs are kept.

Mail text is untrusted data. `server/mail-parse.js` only pattern-matches it (ES/EN) and extracts kind (`charge`, `refund`, `upcoming`, `cancel`, `failed`, `noise`), merchant, amount and currency, charge date, period, next charge, trial end, order number and the last 4 card digits, with a confidence 0–100. The search leaves Gmail's promotions, social and forums tabs out (`-category:promotions -category:social -category:forums`). Replies (`Re:`), opinion requests («¿Qué tal tu pedido?», «Da tu opinión»), newsletters and marketing senders (`newsletter@`, `info-promo@`, `deals.` hosts), carrier notices, gift or promo mail and support conversations are noise and never reach review. A mention of a refund without any amount is not a refund. Labels followed by blank lines and then the value («TOTAL», blank line, «€ 24.03»; «Importe:», blank line, «16.92 EUR») are read, `TOTAL` beats `Subtotal`, and a delivery date («Llega el…») is never the charge date. A charge or refund with merchant, amount and date and confidence ≥ `min_confidence` (70) is recorded automatically as a negative-cent entry (`source = mail`, `source_ref = mail:<message-id>`, note `«subject» · correo`). The category is the one most used before for that counterparty, else the known-merchant hint matched by name to an existing category (never created automatically), else none. Merchant names keep the brand only («Account Services», «(Customer Support)», `.es`, `no-reply` are dropped), and a charge with merchant, amount and date plus an order or receipt cue scores at least 75. Charges above `review_above` (500 € by default, 0 turns the check off; editable in Correo) always wait in review with «importe alto (revísalo)». Anything else goes to **Por revisar** with the reason (no account chosen, several accounts, currency differs, amount or date missing, low confidence, order cancelled). Renewal notices, trials, cancellations and failed payments are not entries: they update the subscription and raise an alert.

Settings (`mail.*`, `notify.*` in the settings table): `enabled`, `auto_record`, `account` (when empty and exactly one active account exists, that one is used; otherwise charges go to review), `interval_min`, `first_days`, `window_days`, `min_confidence`, `review_above`, `toast`, `hub`, `faustus_dir`, `faustus_owner`.

### How duplicates are avoided

1. The same message id is never processed twice.
2. Order references (Amazon 3-7-7 numbers, «número de pedido es N», `GS.xxxx-…`, «Pedido N», «order #…», «n.° N») are kept in `order_ref`: a later mail for the same merchant and order (status, repeat, reply) never records again, and when the first one still waits in review without an amount, the later one completes it. Short numbers (under 7 characters, typical of restaurants) only match within one day.
3. An existing entry of any source (including a bank CSV import) with the same signed amount, a date within 3 days and a matching counterparty makes the mail a `duplicate` linked to that entry.
4. When a bank CSV arrives after the mail was recorded, the bank row adopts the mail's entry instead of adding a second one: there stays ONE entry, the bank's date, amount and account win, the mail stays attached as the entry's `source_ref` and a note, and the import preview and result report it as `matched_mail` (not counted in `rows_new`).
5. `mail_undo` / **Deshacer** deletes the entry the mail created (confirmation required) and sets the mail to `ignored`; it refuses once a bank row has adopted the entry.

A mail that cancels an order already recorded («pedido cancelado») is not a subscription alert: it waits in review with «Quitar el movimiento» and «Dejarlo como está», and undoing the order closes it. Shops, food and restaurants (Amazon, delivery apps, stores) are never subscriptions by themselves: only explicit membership wording («Amazon Prime») does, repeated charges are not enough, and footer links such as «Cancelar suscripción» count for nothing. Platforms that bill several services (Google Play) get one subscription per product, so their prices are never compared with each other.

### Notifications

Stored (last 200) and shown in Correo and by `ledger_notifications`. Windows toast through a temporary UTF-8 BOM `.ps1` run hidden with PowerShell (win32 only; low-severity ones of a scan are condensed into one toast). Family bus events (`family.emit`): `ledger.mail.recorded` {entry_id, merchant, amount, date}, `ledger.subscription.new`, `ledger.subscription.price`, `ledger.subscription.trial`, `ledger.payment.failed`, plus `ledger.subscription.upcoming` and `ledger.subscription.cancelled`. Severity: low for recorded or cancelled, medium for a new subscription, price change or yearly renewal within 7 days, high for failed payments and trials ending within 3 days. Each alert fires once (dedupe key).

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

Tools (38):

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
| `recurring_candidates` | Likely recurring expenses, typical/latest amounts and evidence; separates stable price changes from variable bills. It does not prove a subscription or tariff change. |
| `list_scenarios`, `get_scenario`, `create_scenario` | Browse and create saved what-if scenarios. |
| `add_scenario_line`, `update_scenario_line`, `delete_scenario_line` | Add or correct future assumptions without altering real entries. |
| `cash_forecast` | Compare recorded balances with a scenario for 1–24 months. |
| `balance` | Balance of one account (or all) at a date. |
| `update_entry` | Edit an entry's fields. |
| `delete_entry` | Delete an entry (destructive; removes both halves of a transfer). |
| `upsert_category` | Create or update a category by name. |
| `set_budget` | Set or clear a monthly budget. |
| `import_csv_preview` | Analyse CSV text: columns, guessed mapping, sample rows, duplicates. |
| `import_csv_commit` | Import into an account with dedupe by hash (safe to repeat). |
| `transfer` | Move money between two accounts. |
| `mail_status` | Mail reading status: account read via Faustus, last scan, errors, pending review. |
| `mail_scan` | Read the mail now (`since_days`, `query`) and record payments and subscriptions. |
| `mail_review` | List payments waiting for review and why. |
| `mail_accept` | Record a queued mail payment, with optional `account`, `category`, `amount`, `date`, `merchant`. |
| `mail_ignore` | Mark a mail as not a payment. |
| `mail_undo` | Delete the entry a mail created and ignore the mail (`confirm: true`). |
| `mail_reset` | Wipe the mail import: mails read, subscriptions created from mail, notifications and scan history (`confirm: true`; entries only with `delete_entries: true`, and then only those a mail created and no bank row adopted). Only when the user asks. |
| `mail_paste` | Record a receipt that is not in the inbox from `subject`, `text`, `from`. |
| `subscriptions_list` | Subscriptions by `status` with monthly and yearly totals. |
| `subscription_update` | Set status (cancelled / paused / active), amount, period, category, next charge, notes. |
| `subscriptions_upcoming` | Charges and trial ends in the next `days` (30). |
| `mail_spending` | What the mail recorded in a `month`, by merchant and category, with entry links. |
| `ledger_notifications` | Recent notifications: recorded payments, new subscriptions, price changes, trials, failed payments. |

Every description ends with a `Sinónimos:` line of Spanish words. Ambiguous account or category names return `candidates` so the assistant can ask instead of guessing.

## Data and limits

- `data/ledgers-hoard.db` — SQLite in WAL mode, schema migrations in `server/db.js` (`schema_version` table).
- `data/mcp-token` — 32 random bytes written at every start; never committed.
- Requests are accepted only from `localhost` / `127.0.0.1` origins; cross-site requests are rejected.
- CSV bodies up to 10 MB; `list_entries` returns at most 200 rows per call for tools and 500 for the UI.
- The server makes no network calls itself. Mail is read only through the Faustus helper process, which is the only part that talks to the mail server.
- Mail text is stored as a 300-character snippet per message, with control characters removed.

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
          agent-routes.js, mcp.js, port.js, mail-engine.js, mail-parse.js, mail-merchants.js,
          mail-match.js, mail-source.js, mail-scheduler.js, mail-routes.js, mail-tools.js,
          mail-settings.js, subscriptions.js, notifications.js, mail/faustus_mail.py (helper run by Faustus's Python)
shared/   money.js (parseAmount / formatCents, used by server and client)
client/   React 19 + Vite + Tailwind v4 (pages: Resumen, Movimientos, Cuentas, Categorías, Importar, Informes, Previsión, Correo, Suscripciones, Ajustes)
scripts/  launch.mjs, dev.mjs
tests/    node:test suites
```

License: MIT (see `LICENSE`).
