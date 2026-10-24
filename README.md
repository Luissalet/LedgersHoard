# Ledger's Hoard

Entries offers a separate partial-tag filter alongside the general search. It
searches saved tags without matching notes or counterparties, combines with the
other filters, and can be cleared independently. Native SQL LIKE semantics
remain: `%` matches multiple characters and `_` one. This is not exact tag
membership. Existing pagination and loaded totals by currency remain unchanged.

**Reports → View movements** opens each recorded movement behind an anomaly or
recurring candidate by its original ID. A separate action opens the flagged
charge even when it is absent from the earlier evidence. Native order and
currency remain intact; changing month hides previous evidence while loading
or after an error and offers a retry. Navigation never confirms a billing
error, payment or subscription and does not change records. API/MCP49 and the
existing calculations are unchanged.

**Entries → Tags** displays saved tags and lets you add or remove whole strings
in a small dialog. Commas, spaces and # are literal, with no splitting. Save
includes the new-text field and patches only `tags`, preserving order and repeats;
the native core trims outer whitespace and validates up to 20 strings of 40 characters.
Errors and later edits preserve the draft; closing cannot cancel a submitted write.
Transfer tags remain read-only. Search also checks tags using the existing textual
matching, not an exact-tag filter. Existing API/MCP (49 tools) and `update_entry {id,tags}`
remain unchanged; no global tag catalog or note rewriting.

**Entries → Find payment** looks up recorded expenses by exact amount within five
days either side of a date, with optional merchant and currency. Native matches
retain their score and link to the original entry. Merchant affects ranking,
not exclusion; a match is not confirmation that an invoice was paid. No entries
are changed. The same lookup is available as `tx_find` through API/MCP.

**Accounts → Query balances at a date** shows the stored opening balance plus entries dated up to and including the chosen cutoff, per account and currency. It includes archived accounts with their current archive status; it does not reconstruct historical changes to the opening balance or account status. The applied date is labelled, changing the cutoff clears the old result, and errors or data refreshes keep the selected date. `GET /api/accounts/balances?at=YYYY-MM-DD` returns `{at, accounts}` through the same native `accountBalances(at)` calculation as MCP `balance`; the existing `/api/accounts` response is unchanged.

Local-first household ledger: accounts, categorised entries, monthly budgets, reports, bank CSV imports, payments read from your mail, shared expenses and a month-end forecast, stored in a single SQLite file on your own computer and exposed to an assistant through MCP.

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

- **Resumen** — month picker, income / expense / net / total balance tiles, budget bars per category (over budget in the danger colour, with a written "Superado" chip), recent entries and account balances, plus a «Del correo este mes» line with what the mail recorded and the «Saldo previsto a fin de mes» card (expandable lines).
- **Movimientos** — filterable table (date range, account, category, free text) with a quick-add row at the top (Enter saves, Escape cancels), inline edit, delete with confirmation, a transfer form to move money between accounts, chips for the documents attached to a movement (they open in the app that owns them) and a «Repartir» button for expenses.
  The list starts with 100 movements. «Cargar más movimientos» appends the native next page and shows the loaded count against the filtered total; failed requests can be retried without losing the loaded rows or drafts. Changing filters or refreshing restarts pagination. Sums cover only loaded rows (including transfer rows), separately by the account's stored currency, without exchange conversion. Concurrent additions/deletions can shift offset pages: refresh to start again. Single-movement links still load that movement directly.
- **Compartidos** — who owes you for expenses you paid and split (Repartir on a movement): balance per person, the expenses behind it, «Apuntar devolución». Opens a movement from `#/movimientos?tx=<id>`.
- **Cuentas** — cash, bank, card, savings or other; currency per account; opening balance; archive instead of delete when there are entries.
- **Categorías** — expense and income categories with optional parent, colour and a monthly budget editable in place. A Spanish default set (Comida, Casa, Transporte, Ocio, Salud, Suscripciones, Ropa, Regalos, Otros gastos; Nómina, Otros ingresos) is seeded the first time the table is empty.
- **Importar** — paste or choose a bank CSV. Delimiter (`;`, `,`, tab), header row, dates (`DD/MM/YYYY`, `YYYY-MM-DD`, `DD-MM-YYYY`), Spanish decimal comma and separate debit/credit columns are detected; the mapping can be corrected with selects; the preview shows the first 20 rows and how many are duplicates; commit reports added / skipped.
- **Informes** — 12-month income vs expense bars and expense-by-category donut, both inline SVG with a table view; **Cargos fuera de lo normal** lists recent charges that break their merchant's own pattern (a repeat of the same amount within 3 days, a spike against the merchant's median, an extra charge from a once-a-month merchant, a large first charge), each with its reason and the entries behind it (`anomalies.js`, read-only).

  **Informe anual** exposes the existing `report_year` / `GET /api/reports/year` result: choose a year and currency, inspect January–December income, expense and net plus category totals. Transfers stay excluded and currencies are never added or converted. Month links open the dated movement list for all accounts/currencies, where its existing filters remain available. The rolling reports and charts are preserved. This reads recorded entries, not a forecast; MCP remains 49 tools.
- **Previsión** — save named what-if scenarios with one-time, monthly or quarterly income/expense assumptions, edit them, and compare recorded vs projected balances for 3–24 months. Compare two scenarios side by side with monthly and cumulative B minus A differences, account breakdowns and a separate view for each currency. Both assumption lists stay visible. Observed recurring candidates can fill the assumption form for review. Transfers are already reflected in recorded balances; scenario lines never create entries. Recorded balances include posted entries through each month's end; assumptions accumulate from the selected starting month.
- **Correo** — reads the mail account connected to Faustus, finds payments (receipts, «has pagado», card notices, bills with «importe a cargar», shop orders with a total, refunds) and records them as expenses on the charge date. Status card (mail source auto / hub / Faustus and where it reads from, account read, last and next scan, last error, «Leer ahora», on/off, auto-record, account for mail charges, interval, review limit in euros, toast and family-bus switches), «Apuntado desde el correo» with Deshacer, «Por revisar» with Aceptar (merchant, amount, date, account and category editable) and Ignorar, duplicates seen, recent notifications, and a box to paste a receipt that is not in the inbox.
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
| `GET /api/reports/anomalies?to=YYYY-MM&months=12&recent_days=45` | Read-only charges of the last `recent_days` that break their merchant's pattern: `duplicate`, `amount_spike`, `extra_charge`, `new_merchant_large`, with severity, reason and evidence. |
| `GET/POST /api/scenarios`, `GET/PATCH/DELETE /api/scenarios/:id` | List, create, read, rename and delete saved scenarios. |
| `POST/PATCH/DELETE /api/scenarios/:id/lines[/:lineId]` | Add, edit and remove signed one-time or monthly assumptions. |
| `GET /api/forecast?scenario_id=&from=YYYY-MM&months=6` | Recorded and projected monthly balances by account, with the scenario lines that contributed. |
| `GET /api/forecast/compare?scenario_id=&comparison_id=&from=YYYY-MM&months=6` | Compare A and B, or omit either id for recorded balances. Monthly and cumulative differences by account and currency; both assumption lists included. |
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
| `GET /api/copilot/info` | Faustus copilot: `{ app_id, app_name, data_space_id, panel_url, ... }`; 503 `copilot_unavailable` when Faustus is not reachable. |
| `GET /api/copilot/panel.js` | The Faustus panel script, relayed from Faustus. |
| `GET /api/copilot/launcher.js` | The floating button and panel launcher the app adds to every HTML page. |
| `POST /api/copilot/proxy` | `{ path, method, body? }`: relays the panel's chat calls to Faustus (only `/api/chat_stream`, `/api/chat/*`, `/api/session(s)` and `/api/hoard-copilot/*`), adds this app's origin and keeps the Faustus token out of the browser. |

## Mail: payments and subscriptions

Mail comes from one of two sources (`mail.source`, chosen in Correo): the family hub's mail gateway, which reads the inbox once for every Hoard app, or the Faustus helper. `auto` (default) uses the hub when its gateway is on and falls back to the helper when it is not; `hub` never falls back; `faustus` never asks the hub. With the hub, Ledger registers what it searches (payment words), reads only the messages after a stored watermark (`mail.hub_since_id`; a search with a query or a longer look-back re-reads from the start and leaves it alone), and claims every payment it records (kind `payment`, ref `hoard://ledger/tx/<id>`) so other apps do not file the same mail. The registration is renewed every 6 hours and when the mail settings change. Through the helper: `server/mail/mail_helper.py` (the family's one mail helper, a byte-identical copy of Hoard Link's `hoard_link/mail_helper.py`) runs with Faustus's own Python inside the Faustus folder and returns only the messages that match a payment search (`gmail_query` ORs the subject words and merchant domains for Gmail, `subject_terms` for other IMAP servers; the helper has no search words of its own). The source, the router, the watermark and the claims are the family's `famMailRouter` (`server/hoard-link.js`); `server/mail-source.js` keeps only Ledger's settings, search words and status. The password never reaches this app. The first scan covers `first_days` (62: this month and the previous one); later scans cover `window_days` (14). A scan runs 30 s after start and then every `interval_min` minutes, one at a time; the last 50 runs are kept.

Mail text is untrusted data. `server/mail-parse.js` only pattern-matches it (ES/EN) and extracts kind (`charge`, `refund`, `upcoming`, `cancel`, `failed`, `noise`), merchant, amount and currency, charge date, period, next charge, trial end, order number and the last 4 card digits, with a confidence 0–100. The search leaves Gmail's promotions, social and forums tabs out (`-category:promotions -category:social -category:forums`). Replies (`Re:`), opinion requests («¿Qué tal tu pedido?», «Da tu opinión»), newsletters and marketing senders (`newsletter@`, `info-promo@`, `deals.` hosts), carrier notices, gift or promo mail and support conversations are noise and never reach review. A mention of a refund without any amount is not a refund. Labels followed by blank lines and then the value («TOTAL», blank line, «€ 24.03»; «Importe:», blank line, «16.92 EUR») are read, `TOTAL` beats `Subtotal`, and a delivery date («Llega el…») is never the charge date. A charge or refund with merchant, amount and date and confidence ≥ `min_confidence` (70) is recorded automatically as a negative-cent entry (`source = mail`, `source_ref = mail:<message-id>`, note `«subject» · correo`). The category is the one most used before for that counterparty, else the known-merchant hint matched by name to an existing category (never created automatically), else none. Merchant names keep the brand only («Account Services», «(Customer Support)», `.es`, `no-reply` are dropped), and a charge with merchant, amount and date plus an order or receipt cue scores at least 75. Charges above `review_above` (500 € by default, 0 turns the check off; editable in Correo) always wait in review with «importe alto (revísalo)». Anything else goes to **Por revisar** with the reason (no account chosen, several accounts, currency differs, amount or date missing, low confidence, order cancelled). Renewal notices, trials, cancellations and failed payments are not entries: they update the subscription and raise an alert.

Settings (`mail.*`, `notify.*` in the settings table): `enabled`, `auto_record`, `account` (when empty and exactly one active account exists, that one is used; otherwise charges go to review), `interval_min`, `first_days`, `window_days`, `min_confidence`, `review_above`, `toast`, `hub`, `faustus_dir`, `faustus_owner`, `source` (`auto` | `hub` | `faustus`), `notify_via` (`auto` | `hub` | `own`, stored as `notify.via`). The watermark `mail.hub_since_id` is kept internally.

### How duplicates are avoided

1. The same message id is never processed twice.
2. Order references (Amazon 3-7-7 numbers, «número de pedido es N», `GS.xxxx-…`, «Pedido N», «order #…», «n.° N») are kept in `order_ref`: a later mail for the same merchant and order (status, repeat, reply) never records again, and when the first one still waits in review without an amount, the later one completes it. Short numbers (under 7 characters, typical of restaurants) only match within one day.
3. An existing entry of any source (including a bank CSV import) with the same signed amount, a date within 3 days and a matching counterparty makes the mail a `duplicate` linked to that entry.
4. When a bank CSV arrives after the mail was recorded, the bank row adopts the mail's entry instead of adding a second one: there stays ONE entry, the bank's date, amount and account win, the mail stays attached as the entry's `source_ref` and a note, and the import preview and result report it as `matched_mail` (not counted in `rows_new`).
5. `mail_undo` / **Deshacer** deletes the entry the mail created (confirmation required) and sets the mail to `ignored`; it refuses once a bank row has adopted the entry.

A mail that cancels an order already recorded («pedido cancelado») is not a subscription alert: it waits in review with «Quitar el movimiento» and «Dejarlo como está», and undoing the order closes it. Shops, food and restaurants (Amazon, delivery apps, stores) are never subscriptions by themselves: only explicit membership wording («Amazon Prime») does, repeated charges are not enough, and footer links such as «Cancelar suscripción» count for nothing. Platforms that bill several services (Google Play) get one subscription per product, so their prices are never compared with each other.

### Notifications

Stored (last 200) and shown in Correo and by `ledger_notifications`. The person is told through the family hub's notification facet (quiet hours, spheres, phone; priority from severity, group `ledger`, the dedupe key) and, when the hub is not there, by a Windows toast (`notify.via`: `auto` hub first, `hub` never a toast, `own` toast only). A message the hub holds on purpose (quiet hours) is not repeated as a toast; each stored alert records `delivered.via` and `delivered.held`. The toast is the family's `showToast`: a temporary UTF-8 BOM `.ps1` run hidden with PowerShell (win32 only, attributed to «Ledger's Hoard»); a scan shows at most 3 alerts plus one summary of the rest. Family bus events (`family.emit`): `ledger.mail.recorded` {tx_id, entry_id, merchant, amount, amount_cents, currency, date, order_ref?, message_id, items}, `ledger.payment.failed` {merchant, amount, …}, `ledger.subscription.price` {merchant, amount, old_amount, currency, …}, `ledger.subscription.new` {merchant, amount, currency, period, url, …}, `ledger.subscription.trial`, plus `ledger.subscription.upcoming` and `ledger.subscription.cancelled`. Severity: low for recorded or cancelled, medium for a new subscription, price change or yearly renewal within 7 days, high for failed payments and trials ending within 3 days. Each alert fires once (dedupe key). In event payloads `amount` is a positive number in major units (12.99), and `amount_cents` is the signed value stored; the purchases view of the hub is built from `ledger.mail.recorded`.

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

Tools (46):

| Tool | Purpose |
| --- | --- |
| `list_accounts` | Accounts with current balance. |
| `upsert_account` | Create an account or update the one with the same name (case/accent-insensitive): type, currency (default EUR), opening balance as text, archived. |
| `list_categories` | Categories with budgets, optionally by kind. |
| `add_entry` | Record a movement: amount as text, kind `expense` / `income` / `auto`, account and category by name (fuzzy, accent-insensitive; the only account is used automatically; category created only with `create_category: true`). Returns the stored entry and the resolved account/category. |
| `list_entries` | Filter by dates, account, category, text, tag; limit ≤ 200. |
| `search_entries` | Free text over counterparty, note, tags and category. |
| `summary` | Monthly totals, per category with budget, per account. |
| `budget_status` | Budget vs spent per category (optionally one `category` and a `month`) with `over`, `left`, `ok` and a human verdict. |
| `months_report` | Per-month income / expense / net between two months. |
| `recurring_candidates` | Likely recurring expenses, typical/latest amounts and evidence; separates stable price changes from variable bills. It does not prove a subscription or tariff change. |
| `spending_anomalies` | Recent charges that break their merchant's own pattern (double charge, spike, extra monthly charge, large first charge), with reason, severity and evidence ids; optional `account`. Signals to review, never proof of fraud. |
| `list_scenarios`, `get_scenario`, `create_scenario` | Browse and create saved what-if scenarios. |
| `add_scenario_line`, `update_scenario_line`, `delete_scenario_line` | Add or correct future assumptions without altering real entries. |
| `cash_forecast` | Compare recorded balances with a scenario for 1–24 months. |
| `compare_cash_forecasts` | Compare two scenarios over the same 1–24 months, with monthly/cumulative B minus A differences per account and currency. Omit an id for recorded balances. |
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
| `tx_find` | Find the expense movement that matches an amount and date (an invoice's), with a score; 0.8 or more is a strong match. |
| `tx_attach_doc` | Keep a `hoard://app/kind/id` document reference on a movement (idempotent); it shows as a chip that opens the document in its app. |
| `forecast_month` | Projected balance at the end of a month (up to 12 ahead): today's balance, subscriptions, recurring charges and income, plus the 3-month average for the rest of the spending. Every line says where it comes from. |
| `split_add` | Split a movement you paid among people (by share, amount or equally with you). People are resolved through the family address book and the name is kept for when it is offline. |
| `splits_balance` | Who owes what: balance per person, oldest open date, expenses behind it. |
| `split_settle` | Record a payback; applied to the oldest open shares first, never more than is owed. |
| `income_from_sales` | Book the income of a sales batch from Mercator, one entry per currency and day, idempotent per batch and line. |
| `report_year` | Totals of a year by month and by category. |
| `ledger_notifications` | Recent notifications: recorded payments, new subscriptions, price changes, trials, failed payments. |

Every description ends with a `Sinónimos:` line of Spanish words. Ambiguous account or category names return `candidates` so the assistant can ask instead of guessing.

## Faustus copilot

Every page has a floating **Faustus** button (bottom right) that opens the Faustus assistant in a side panel. The conversation, model, memory and tools live in Faustus: this app only relays the panel (`/api/copilot/*`) and keeps no history. It needs Faustus running (`HOARD_FAUSTUS_URL`, default `http://127.0.0.1:7000`); without it the button explains that the copilot is unavailable and the rest of the app is unaffected.

What every turn tells the assistant (`window.hoardCopilot.context()`, read through the app's own API):

- `view.page` (`summary`, `entries`, `shared_expenses`, `accounts`, `categories`, `import`, `reports`, `forecast`, `mail`, `subscriptions`, `settings`), the month on Resumen, Informes and Correo, and the movement filters on Movimientos.
- `active_objects`: the month summary; the movement open at `#/movimientos?tx=<id>`; the account and category used as filters; the scenario open in Previsión with its lines; the person being settled in Compartidos; and the object behind any open edit form (movement, account, category, subscription, scenario line). A creation form, `tx=new` or an unknown id adds no object.
- `view.editor`: the fields typed in the open form and which of them changed (the quick-add row, an inline movement edit, an account or subscription form, a scenario line, a pasted CSV import, the settings). Several open forms are listed in `view.editors`.

When the assistant finishes a turn the open page reloads its data in place: accounts, categories, the list, the month, the scenario. Forms keep what you typed. Editing saves **only the fields you changed**, so a change the assistant made to another field in the meantime is not overwritten.

Turn it off with `HOARD_COPILOT=0` (no `/api/copilot/*` routes, no button). The client is in `client/src/copilot-context.js` (context and refresh) and `client/src/copilot-hooks.js` (what each page and form reports).

## Family

Ledger takes part in the Hoard family hub, always optionally: with the hub away every feature below still answers, with a clear error where another app is needed.

- **Mail**: through the hub's gateway, see above.
- **Agenda**: `GET /api/family/agenda` (bearer token of the app) lists subscription renewals, trial ends (urgent from one day left, high from three), expected recurring charges (`Cargo previsto`, low priority) and shared-expense debts older than 30 days (`followup`).
- **Documents**: a movement keeps references to documents of other apps (`docs`); Kafka's chips link to `#/movimientos?tx=<id>`, which shows that one movement with a «Ver todos» button. In Movimientos, **Vincular documento** saves a `hoard://app/kind/id` reference and optional label. **Cambiar etiqueta** keeps the selected reference fixed; repeating a reference updates its label without duplicating it or changing its original `added_at`. A blank label keeps the previous one. The native result identifies new or existing links and supplies their order. Saving stores only local metadata: it does not copy a file, check the document's existence or availability, or open its app. Existing document chips still open explicitly through the current Hub resolver. Pending reference/label fields and saved document links are separate in copilot context.
- **Shared expenses**: *Repartir* on an expense in Movimientos, and the page **Compartidos** with balances and paybacks. People resolve through the address book (`family.call("people", …)`).
- **Forecast**: a card in Resumen with the projected balance at the end of the month and its lines.
- **Events** in the hub's bus: see Notifications.

REST routes used by the pages: `GET /api/forecast/month`, `GET /api/reports/year`, `POST|DELETE /api/entries/:id/docs`, `GET /api/doc-link?ref=`, `GET|DELETE /api/entries/:id/splits`, `POST /api/splits`, `GET /api/splits/balance`, `POST /api/splits/settle`, `GET /api/mail/source`.

## Data and limits

- `data/ledgers-hoard.db` — SQLite in WAL mode, schema migrations in `server/db.js` (`schema_version` table).
- `data/mcp-token` — 32 random bytes written at every start; never committed.
- Requests are accepted only from `localhost` / `127.0.0.1` origins; cross-site requests are rejected.
- CSV bodies up to 10 MB; `list_entries` returns at most 200 rows per call for tools and 500 for the UI.
- The server talks to nothing outside the machine. Mail is read through the family hub's gateway (local) or the Faustus helper process, the only part that talks to a mail server; the hub is also asked, locally, for the address book and for the address of other apps.
- Mail text is stored as a 300-character snippet per message, with control characters removed.

## Shared with the family (Hoard Link 0.8)

`server/hoard-link.js` and `server/hoard-commons/` are vendored copies of the commons; Ledger keeps no second copy of what they do. Money (`shared/money.js` keeps `parseAmount` -> integer cents and `formatCents(cents, symbol)` over `hoard-commons/money.js`; `"$1.234"` reads as 1.234 and `"1.234"` alone as 1234), dates (`addDays`, `daysBetween`, year-less dates in mail), order references, the merchant table (about 190 merchants; unknown merchants are keyed by their name without the legal suffix, and migration 5 re-keys what was stored under the old key), the request guard, the agent routes (`/api/agent/*`, results capped at 20 000 bytes, one JSON error envelope `{ error, code?, issues?, candidates? }`), the MCP bridge (`server/mcp.js`), the SPA server, the SQLite wrapper (`BEGIN IMMEDIATE`, savepoints, busy timeout, WAL checkpoint on exit) and the port and token helpers. The MCP token (`<data>/mcp-token`) is created once and kept across restarts. Shared expenses (`split_add`) share fractions by largest remainder together with what stays with the user, so the parts always add up to the expense.

What stays Ledger's own: parsing of payment mail (`mail-parse.js`), the engine, subscriptions, the budget and forecast, the strict `parseDate` and `YYYY-MM` month arithmetic of `server/dates.js`, and the variable-interval mail scheduler (`mail-scheduler.js`). The commons are not browser-safe (`hoard-commons/text.js` imports `node:fs`), so `vite build` prints two "externalized" warnings for the client bundle; nothing in the client calls them.

## Verification

```sh
npm test        # node --test tests/*.test.js — parser, CSV, reports, HTTP API, agent auth and tools, commons
npm run build   # vite build → dist/
```

Tests use temporary data directories and never touch `data/`.

## Layout

```
server/   app.js (Express), index.js (boot), db.js, accounts.js, categories.js, entries.js,
          reports.js, csv.js, imports.js, dates.js, money.js, routes.js, agent-tools.js,
          mcp.js, mail-engine.js, mail-parse.js, mail-match.js, mail-source.js, mail-scheduler.js,
          mail-routes.js, mail-tools.js, mail-settings.js, subscriptions.js, notifications.js,
          mail/mail_helper.py (the family's mail helper, run by Faustus's Python),
          hoard-link.js + hoard-commons/ (vendored from Hoard Link 0.8: money, dates, merchants, text, ics,
          guard, agent routes, MCP bridge, SPA, database, token and port helpers; do not edit),
          family.js (hub client), family-tools.js, family-routes.js, tx-links.js, splits.js, sales.js, outlook.js, agenda.js
shared/   money.js (parseAmount / formatCents, thin names over hoard-commons/money.js; used by server and client)
client/   React 19 + Vite + Tailwind v4 (pages: Resumen, Movimientos, Cuentas, Categorías, Importar, Informes, Compartidos, Previsión, Correo, Suscripciones, Ajustes)
scripts/  launch.mjs, dev.mjs
tests/    node:test suites
```

License: MIT (see `LICENSE`).
