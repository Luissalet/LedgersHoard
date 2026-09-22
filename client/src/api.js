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
  imports: {
    list: () => request("GET", "/api/imports"),
    preview: (data) => request("POST", "/api/imports/preview", data),
    commit: (data) => request("POST", "/api/imports/commit", data),
  },
};
