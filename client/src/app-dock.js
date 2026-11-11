import { collectContext, onTurnEnd } from "./copilot-context.js";

const fold = (value) => String(value || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
function choose(items, name, label) {
  const exact = items.filter((item) => fold(label(item)) === fold(name));
  const matches = exact.length ? exact : items.filter((item) => fold(label(item)).includes(fold(name)));
  if (matches.length !== 1) throw Object.assign(new Error(matches.length ? "Several records match; use an id" : "Record not found"), {
    code: matches.length ? "ambiguous" : "not_found", candidates: matches.slice(0, 8).map((item) => ({ id: item.id, label: label(item) })),
  });
  return matches[0];
}

export function installAppDock({ api, pages }, target = window) {
  const app = target.HoardApp ||= { q: [] };
  const send = (method, ...args) => app[method] ? app[method](...args) : app.q.push([method, ...args]);
  let active = true;
  const point = async (cursor) => { const el = target.document.querySelector("main h1, main"); if (el) await cursor.to(el); };
  const tool = (name, description, properties, required, handler) => send("registerTool", name, {
    description, inputSchema: { type: "object", properties, required, additionalProperties: false },
  }, handler);
  const text = { type: "string", minLength: 1 };
  tool("ledger_open", "Show one movement by id or unique counterparty or note", { id: text, name: text }, [], async ({ id, name }, { cursor }) => {
    if (!id && !name?.trim()) throw Object.assign(new Error("Provide id or name"), { code: "bad_args" });
    const entry = id ? await api.entries.get(id) : choose((await api.entries.list({ text: name, limit: 100 })).items, name, (e) => e.counterparty || e.note);
    if (!entry?.id) throw Object.assign(new Error("Movement not found"), { code: "not_found" });
    await point(cursor);
    target.location.hash = `#/movimientos?tx=${encodeURIComponent(entry.id)}`;
    return { opened: entry.id };
  });
  tool("ledger_filter", "Filter movements by account or category id/name, dates, text and tag", {
    account: { type: "string" }, category: { type: "string" }, from: { type: "string" }, to: { type: "string" }, text: { type: "string" }, tag: { type: "string" },
  }, [], async (filter, { cursor }) => {
    const resolved = { from: "", to: "", account: "", category: "", text: "", tag: "", ...filter };
    if (filter.account || filter.category) {
      const state = await api.state();
      for (const key of ["account", "category"]) if (filter[key]) {
        const rows = key === "account" ? state.accounts : state.categories;
        resolved[key] = (rows.find((row) => row.id === filter[key]) || choose(rows, filter[key], (row) => row.name)).id;
      }
    }
    await point(cursor);
    target.location.hash = `#/movimientos?${new URLSearchParams(resolved)}`;
    return { view: "movimientos", filters: resolved };
  });
  tool("ledger_view", "Switch the Ledger section", { view: { type: "string", enum: pages } }, ["view"], async ({ view }, { cursor }) => {
    await point(cursor); target.location.hash = `#/${view}`; return { view };
  });
  send("setContext", () => {
    const route = target.location.hash.replace(/^#\/?/, "") || "resumen";
    const page = route.split("?")[0];
    const info = collectContext(target);
    const id = new URLSearchParams(route.split("?")[1] || "").get("tx");
    const editor = info.editors.find((item) => item.object_id);
    return { view: page, focus: editor ? { kind: editor.kind, id: editor.object_id, label: editor.fields?.counterparty || "" }
      : page === "movimientos" && id ? { kind: "movement", id, label: "" } : undefined,
      summary: JSON.stringify(info.view || {}).slice(0, 400) };
  });
  const unsubscribe = send("onChanged", () => { if (active) onTurnEnd(); });
  return () => { active = false; if (typeof unsubscribe === "function") unsubscribe(); };
}
