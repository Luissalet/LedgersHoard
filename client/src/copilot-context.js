// What the shared Faustus copilot asks this app for: the real objects open in the current view, the unsaved form fields,
// and a way to refresh the open view when the assistant finishes a turn. Nothing here renders anything.
import { api } from "./api.js";

const PAGE_NAMES = {
  resumen: "summary", movimientos: "entries", compartidos: "shared_expenses", cuentas: "accounts", categorias: "categories",
  importar: "import", informes: "reports", prevision: "forecast", correo: "mail", suscripciones: "subscriptions", ajustes: "settings",
};
const EDITOR_ORDER = { "entry-tags": 0, "entry-form": 0, "account-form": 0, "subscription-form": 0, "scenario-line-form": 0, "category-name": 0, "category-budget": 0, "settle-form": 0 };
const MAX_LINES = 8;
const EVENT = "ledger:context-request";

// ---- partial saves -----------------------------------------------------------------------------------------------------

// Fields of `draft` whose value differs from `initial` (compared as JSON, so a cleared text counts as a change).
export function changedFields(initial, draft) {
  const base = initial || {};
  return Object.fromEntries(Object.entries(draft || {}).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(base[key])));
}

// A refreshed baseline arrives while the user is editing: fields the user did not touch follow the new baseline, touched ones stay.
export function rebaseForm(previousBase, nextBase, form) {
  const out = { ...nextBase };
  for (const key of Object.keys(form)) {
    if (JSON.stringify(form[key]) !== JSON.stringify(previousBase?.[key])) out[key] = form[key];
  }
  return out;
}

// ---- route and context --------------------------------------------------------------------------------------------------

export function parseRoute(hash) {
  const [path, query = ""] = String(hash || "").replace(/^#\/?/, "").split("?");
  const parts = path.split("/").filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  return { page: parts[0] || "resumen", query: new URLSearchParams(query) };
}

// Every mounted page and open form answers this event: `editor(snapshot)` for a form ({ kind, object_id, dirty, fields }),
// `view(partial)` for what the page shows (month, filters, selection).
export function collectContext(target = globalThis.window) {
  const editors = [];
  const view = {};
  if (!target?.dispatchEvent) return { editors, view };
  target.dispatchEvent(new CustomEvent(EVENT, {
    detail: {
      editor: (snapshot) => { if (snapshot) editors.push(snapshot); },
      view: (partial) => { if (partial && typeof partial === "object") Object.assign(view, partial); },
    },
  }));
  editors.sort((a, b) => (EDITOR_ORDER[a.kind] ?? 9) - (EDITOR_ORDER[b.kind] ?? 9));
  return { editors, view };
}

// Answer the context request: `getter()` returns { editors?: [snapshot|null], view?: {...} } and is read at ask time.
export function registerProvider(getter, target = globalThis.window) {
  if (!target?.addEventListener) return () => {};
  const handler = (event) => {
    let out = null;
    try { out = getter(); } catch { out = null; }
    if (!out) return;
    for (const snapshot of out.editors || []) if (snapshot) event.detail.editor(snapshot);
    if (out.view) event.detail.view(out.view);
  };
  target.addEventListener(EVENT, handler);
  return () => target.removeEventListener(EVENT, handler);
}

const pick = (source, keys) => Object.fromEntries(keys.filter((k) => source?.[k] !== undefined && source[k] !== null && source[k] !== "").map((k) => [k, source[k]]));

export const entryObject = (e) => ({ kind: "entry", object_id: e.id, title: e.counterparty || "(no description)", ...pick(e, ["date", "amount_cents", "account_name", "category_name", "source", "note", "tags"]), ...(e.transfer_id ? { transfer: true } : {}) });
export const accountObject = (a) => ({ kind: "account", object_id: a.id, title: a.name, ...pick(a, ["type", "currency", "archived"]), ...(a.balance != null ? { balance_cents: a.balance } : {}), ...(a.opening_balance != null ? { opening_balance_cents: a.opening_balance } : {}) });
export const categoryObject = (c) => ({ kind: "category", object_id: c.id, title: c.name, ...(c.kind ? { category_kind: c.kind } : {}), ...pick(c, ["parent_id", "archived"]), ...(c.monthly_budget != null ? { monthly_budget_cents: c.monthly_budget } : {}) });
export const subscriptionObject = (s) => ({ kind: "subscription", object_id: s.id, title: s.merchant, ...pick(s, ["status", "amount_cents", "currency", "period", "next_charge_date", "trial_end_date", "category_id"]) });
export const scenarioObject = (s) => ({ kind: "scenario", object_id: s.id, title: s.name, lines: (s.lines || []).length });
export const scenarioLineObject = (l, scenarioId) => ({ kind: "scenario_line", object_id: l.id, title: l.label, scenario_id: scenarioId, ...pick(l, ["account_id", "amount_cents", "start_month", "end_month", "cadence"]) });
export const monthObject = (summary) => ({ kind: "month", object_id: summary.month, title: summary.month, ...pick(summary, ["income", "expense", "net"]), ...(summary.budget ? { budget_total_cents: summary.budget.total, budget_spent_cents: summary.budget.spent, budgets_over: summary.budget.over } : {}) });
export const personObject = (r) => ({ kind: "person", object_id: r.person_ref || r.person, title: r.person, ...pick(r, ["balance_cents", "direction", "owed_cents", "paid_cents", "oldest_open_date"]) });

async function safe(fn) {
  try { return await fn(); } catch { return null; }
}

// Pure core (dependencies injected so it can be tested): never throws; unknown or "new" ids yield no object.
export async function buildContext({ hash, editors = [], view: viewInfo = {}, getState, getEntry, getSubscriptions, getScenario, getSummary, getBalance }) {
  const route = parseRoute(hash);
  const page = PAGE_NAMES[route.page] || "summary";
  const active = [];
  const seen = new Set();
  const add = (object) => { if (!object?.object_id) return; const key = `${object.kind}:${object.object_id}`; if (!seen.has(key)) { seen.add(key); active.push(object); } };
  const realId = (id) => (id && id !== "new" ? String(id) : null);

  let state = null;
  const stateOnce = async () => (state ||= (await safe(getState)) || {});
  const account = async (id) => (await stateOnce()).accounts?.find((a) => a.id === id);
  const category = async (id) => (await stateOnce()).categories?.find((c) => c.id === id);

  const view = { page };
  if (page === "reports" && viewInfo.report_evidence) view.report_evidence = { ...viewInfo.report_evidence };
  const month = viewInfo.month;
  if (month && ["summary", "reports", "mail"].includes(page)) {
    view.month = month;
    const summary = await safe(() => getSummary(month));
    if (summary?.month) add(monthObject(summary));
  }

  if (page === "entries") {
    if (viewInfo.listing) view.listing = { ...viewInfo.listing };
    const tx = realId(route.query.get("tx") || viewInfo.tx);
    if (tx) {
      const entry = await safe(() => getEntry(tx));
      if (entry?.id) { add(entryObject(entry)); view.object_id = entry.id; }
    }
    if (viewInfo.filters && Object.keys(viewInfo.filters).length) {
      view.filters = viewInfo.filters;
      const a = realId(viewInfo.filters.account);
      if (a) { const row = await account(a); if (row) add(accountObject(row)); }
      const c = realId(viewInfo.filters.category);
      if (c && c !== "none") { const row = await category(c); if (row) add(categoryObject(row)); }
    }
  }

  if (page === "mail" && viewInfo.review_count != null) view.review_count = viewInfo.review_count;

  if (page === "forecast") {
    const id = realId(viewInfo.scenario);
    if (id) {
      const scenario = await safe(() => getScenario(id));
      if (scenario?.id) {
        add(scenarioObject(scenario));
        for (const line of (scenario.lines || []).slice(0, MAX_LINES)) add(scenarioLineObject(line, scenario.id));
        view.object_id = scenario.id;
      }
    }
    for (const key of ["from", "months"]) if (viewInfo[key] != null) view[key] = viewInfo[key];
  }

  if (page === "shared_expenses" && realId(viewInfo.person)) {
    const data = await safe(() => getBalance(viewInfo.person));
    const row = (data?.balances || []).find((r) => (r.person_ref || r.person) === viewInfo.person) || data?.balances?.[0];
    if (row) add(personObject(row));
  }

  if (page === "import") {
    const a = realId(viewInfo.account_id);
    if (a) { const row = await account(a); if (row) add(accountObject(row)); }
  }

  // Objects behind the open forms (an edit form names its object; a creation form names none).
  const subs = async () => (await safe(getSubscriptions))?.subscriptions || [];
  for (const e of editors) {
    const id = realId(e.object_id);
    if (!id) continue;
    if (e.kind === "entry-form" || e.kind === "entry-tags") { const entry = await safe(() => getEntry(id)); if (entry?.id) add(entryObject(entry)); }
    else if (e.kind === "account-form") { const row = await account(id); if (row) add(accountObject(row)); }
    else if (e.kind === "category-name" || e.kind === "category-budget") { const row = await category(id); if (row) add(categoryObject(row)); }
    else if (e.kind === "subscription-form") { const row = (await subs()).find((s) => s.id === id); if (row) add(subscriptionObject(row)); }
    else if (e.kind === "scenario-line-form" && e.scenario_id) {
      const scenario = await safe(() => getScenario(e.scenario_id));
      const line = scenario?.lines?.find((l) => l.id === id);
      if (scenario?.id) add(scenarioObject(scenario));
      if (line) add(scenarioLineObject(line, scenario.id));
    }
  }

  const editor = editors.find((e) => e.dirty) || editors[0];
  if (editor) view.editor = editor;
  if (editors.length > 1) view.editors = editors;
  return { active_objects: active, view };
}

export function context() {
  const { editors, view } = collectContext();
  return buildContext({
    hash: globalThis.window?.location?.hash,
    editors,
    view,
    getState: () => api.state(),
    getEntry: (id) => api.entries.get(id),
    getSubscriptions: () => api.subscriptions.list(30),
    getScenario: (id) => api.scenarios.get(id),
    getSummary: (month) => api.summary(month),
    getBalance: (person) => api.splits.balance(person),
  });
}

// ---- refresh when the assistant finishes a turn --------------------------------------------------------------------------
const refreshers = new Set();
let timer = null;

function scheduleRefresh() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    for (const fn of [...refreshers]) { try { fn(); } catch { /* a refresh must never break the page */ } }
  }, 250);
}

// A page registers what "reload what is on screen" means (it keeps the forms the user is editing untouched).
export function subscribeRefresh(fn) {
  refreshers.add(fn);
  return () => refreshers.delete(fn);
}

export const onTurnEnd = () => scheduleRefresh();

// Once at start: the object the launcher looks for, and the window event it dispatches on turn end (the debounce merges the two).
export function installCopilot(target = globalThis.window) {
  if (!target || target.hoardCopilot) return;
  target.hoardCopilot = { context, onTurnEnd };
  target.addEventListener("hoard:copilot-turn-end", scheduleRefresh);
}
