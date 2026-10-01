// Thin fetch wrapper. Every error surfaces as an Error with the server message.
async function request(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok) throw new Error(data?.error || `Error ${response.status}`);
  return data;
}

const qs = (params) => {
  const clean = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return clean.length ? `?${new URLSearchParams(clean)}` : "";
};

export const api = {
  state: () => request("GET", "/api/state"),
  settings: (patch) => request("PUT", "/api/settings", patch),
  accounts: {
    create: (data) => request("POST", "/api/accounts", data),
    update: (id, data) => request("PATCH", `/api/accounts/${id}`, data),
    remove: (id) => request("DELETE", `/api/accounts/${id}`),
  },
  categories: {
    create: (data) => request("POST", "/api/categories", data),
    update: (id, data) => request("PATCH", `/api/categories/${id}`, data),
    remove: (id) => request("DELETE", `/api/categories/${id}`),
  },
  entries: {
    list: (filter) => request("GET", `/api/entries${qs(filter)}`),
    create: (data) => request("POST", "/api/entries", data),
    update: (id, data) => request("PATCH", `/api/entries/${id}`, data),
    remove: (id) => request("DELETE", `/api/entries/${id}`),
  },
  transfer: (data) => request("POST", "/api/transfers", data),
  summary: (month) => request("GET", `/api/summary${qs({ month })}`),
  months: (from, to) => request("GET", `/api/reports/months${qs({ from, to })}`),
  recurring: (to, months = 18) => request("GET", `/api/reports/recurring${qs({ to, months })}`),
  forecast: (scenario_id, from, months = 6) => request("GET", `/api/forecast${qs({ scenario_id, from, months })}`),
  scenarios: {
    list: () => request("GET", "/api/scenarios"),
    get: (id) => request("GET", `/api/scenarios/${id}`),
    create: (data) => request("POST", "/api/scenarios", data),
    update: (id, data) => request("PATCH", `/api/scenarios/${id}`, data),
    remove: (id) => request("DELETE", `/api/scenarios/${id}`),
    addLine: (id, data) => request("POST", `/api/scenarios/${id}/lines`, data),
    updateLine: (id, lineId, data) => request("PATCH", `/api/scenarios/${id}/lines/${lineId}`, data),
    removeLine: (id, lineId) => request("DELETE", `/api/scenarios/${id}/lines/${lineId}`),
  },
  imports: {
    list: () => request("GET", "/api/imports"),
    preview: (data) => request("POST", "/api/imports/preview", data),
    commit: (data) => request("POST", "/api/imports/commit", data),
  },
  mail: {
    status: (opts) => request("GET", `/api/mail/status${qs({ source: opts?.source ? "1" : "", refresh: opts?.refresh ? "1" : "" })}`),
    settings: () => request("GET", "/api/mail/settings"),
    saveSettings: (patch) => request("PUT", "/api/mail/settings", patch),
    scan: (data) => request("POST", "/api/mail/scan", data || {}),
    review: () => request("GET", "/api/mail/review"),
    recorded: (month) => request("GET", `/api/mail/recorded${qs({ month })}`),
    spending: (month) => request("GET", `/api/mail/spending${qs({ month })}`),
    messages: (filter) => request("GET", `/api/mail/messages${qs(filter)}`),
    runs: () => request("GET", "/api/mail/runs"),
    notifications: (limit = 30) => request("GET", `/api/mail/notifications${qs({ limit })}`),
    accept: (data) => request("POST", "/api/mail/accept", data),
    ignore: (message_id) => request("POST", "/api/mail/ignore", { message_id }),
    undo: (message_id) => request("POST", "/api/mail/undo", { message_id, confirm: true }),
    paste: (data) => request("POST", "/api/mail/paste", data),
    reset: (data) => request("POST", "/api/mail/reset", { confirm: true, ...(data || {}) }),
  },
  subscriptions: {
    list: (days = 30) => request("GET", `/api/subscriptions${qs({ days })}`),
    create: (data) => request("POST", "/api/subscriptions", data),
    update: (id, data) => request("PATCH", `/api/subscriptions/${id}`, data),
    remove: (id) => request("DELETE", `/api/subscriptions/${id}`),
    detect: () => request("POST", "/api/subscriptions/detect", {}),
  },
};
