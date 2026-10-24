import test from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "./helpers.js";
import { createAccount } from "../server/accounts.js";
import { createEntry } from "../server/entries.js";
import { db } from "../server/db.js";
import { buildContext, collectContext, registerProvider } from "../client/src/copilot-context.js";

test("partial native tag query excludes note-only hits and keeps JSON LIKE wildcards, units and pagination", async () => {
  process.env.HOARD_EVENTS = "0";
  const server = await bootServer({ startScheduler: false });
  try {
    const eur = createAccount({ name: "Ficticia EUR", currency: "EUR" });
    const usd = createAccount({ name: "Ficticia USD", currency: "USD" });
    const add = (account, date, tags, note = "") => createEntry({ account_id: account.id, date, amount_cents: -4500, counterparty: "Comercio ficticio", tags, note });
    const a = add(eur, "2026-10-10", ["Viaje 2026"]);
    const b = add(eur, "2026-10-11", [], "Viaje 2026");
    const c = add(usd, "2026-10-30", ["Viaje 2026 largo"]);
    const d = add(eur, "2026-10-12", ["hotel, tren #1"]);
    const before = db().prepare("SELECT * FROM entries ORDER BY id").all();
    const get = async filter => (await server.call("GET", `/api/entries?${new URLSearchParams(filter)}`)).body;
    const ids = result => result.items.map(entry => entry.id).sort();
    assert.deepEqual(ids(await get({ text: "Viaje 2026" })), [a.id, b.id, c.id].sort());
    const page = await get({ tag: "  Viaje 2026  ", limit: 1 });
    assert.equal(page.total, 2); assert.equal(page.nextOffset, 1);
    assert.deepEqual(ids({ items: [...page.items, ...(await get({ tag: "Viaje 2026", limit: 1, offset: page.nextOffset })).items] }), [a.id, c.id].sort());
    assert.deepEqual(ids(await get({ tag: "Via_e 2026" })), [a.id, c.id].sort());
    assert.equal((await get({ tag: "%" })).total, 4); // Native LIKE searches even the [] JSON representation.
    assert.deepEqual(ids(await get({ tag: "hotel, tren #1" })), [d.id]);
    assert.deepEqual(ids(await get({ tag: "Viaje", account: eur.id, from: "2026-10-01", to: "2026-10-20", text: "ficticio" })), [a.id]);
    const agent = await server.agent("list_entries", { tag: "Viaje 2026" });
    assert.equal(agent.status, 200);
    assert.deepEqual(ids(agent.body), [a.id, c.id].sort());
    assert.deepEqual(db().prepare("SELECT * FROM entries ORDER BY id").all(), before);
  } finally { await server.stop(); }
});

test("final copilot context distinguishes current tag criteria from acknowledged rows and retains new-entry draft", async () => {
  const target = new EventTarget();
  let current = { view: { filters: { tag: "Viaje" }, listing: { status: "loading", applied_filters: null, loaded_ids: [], total: null } },
    editors: [{ kind: "entry-new", object_id: null, dirty: true, fields: { counterparty: "Borrador ñ", amount: "-12" } }] };
  const unregister = registerProvider(() => current, target);
  const final = () => buildContext({ hash: "#/movimientos", ...collectContext(target), getState: async () => ({ accounts: [], categories: [] }) });
  try {
    const pending = await final();
    assert.equal(pending.view.filters.tag, "Viaje"); assert.equal(pending.view.listing.applied_filters, null);
    assert.equal(pending.view.listing.total, null); assert.equal(pending.view.editor.fields.counterparty, "Borrador ñ");
    current = { ...current, view: { ...current.view, listing: { status: "ready", applied_filters: { tag: "Viaje" }, loaded_ids: ["a", "c"], total: 2 } } };
    const ready = await final(); assert.deepEqual(ready.view.listing.loaded_ids, ["a", "c"]);
    assert.deepEqual(ready.view.listing.applied_filters, { tag: "Viaje" });
  } finally { unregister(); }
});
