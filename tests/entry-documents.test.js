import test from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "./helpers.js";
import { createAccount } from "../server/accounts.js";
import { createEntry, getEntry } from "../server/entries.js";
import { db } from "../server/db.js";
import { setFamilyApi } from "../server/family.js";
import { buildContext, collectContext, registerProvider } from "../client/src/copilot-context.js";

test("document references retain native identity/order while final context separates saved links from pending fields", async () => {
  process.env.HOARD_EVENTS = "0";
  const server = await bootServer({ startScheduler: false });
  let unregister;
  try {
    setFamilyApi({ appInfo() { throw Error("Saving must not resolve another app"); }, call() { throw Error("No external calls"); } });
    const account = createAccount({ name: "Document fixture EUR", currency: "EUR" });
    const a = createEntry({ account_id: account.id, date: "2026-10-10", amount_cents: -4500, counterparty: "Receipt fixture", note: "Keep note", tags: ["literal, tag #1"], source: "mail", source_ref: "mail:fixture-doc" });
    const b = createEntry({ account_id: account.id, date: "2026-10-11", amount_cents: 1000, counterparty: "Other fixture" });
    const before = db().prepare("SELECT * FROM entries ORDER BY id").all();
    const first = await server.call("POST", `/api/entries/${a.id}/docs`, { doc_ref: " hoard://kafka/document/factura_qa ", label: " Factura ñ " });
    assert.equal(first.status, 201); assert.equal(first.body.already, false);
    await server.call("POST", `/api/entries/${a.id}/docs`, { doc_ref: "hoard://atlas/file/other", label: "Other link" });
    const renamed = await server.agent("tx_attach_doc", { tx_id: a.id, doc_ref: first.body.doc.ref, label: "Corrected label" });
    assert.equal(renamed.body.already, true); assert.equal(renamed.body.doc.added_at, first.body.doc.added_at);
    assert.deepEqual(renamed.body.docs.map(d => d.ref), ["hoard://atlas/file/other", first.body.doc.ref]);
    const empty = await server.call("POST", `/api/entries/${a.id}/docs`, { doc_ref: first.body.doc.ref, label: "" });
    assert.equal(empty.body.doc.label, "Corrected label"); assert.equal(empty.body.docs.length, 2);
    const invalid = await server.call("POST", `/api/entries/${a.id}/docs`, { doc_ref: "not a reference", label: "Draft to preserve" });
    assert.equal(invalid.status, 400);
    const after = db().prepare("SELECT * FROM entries ORDER BY id").all();
    assert.deepEqual(after.filter(row => row.id !== a.id), before.filter(row => row.id !== a.id));
    const stable = row => Object.fromEntries(Object.entries(row).filter(([key]) => !["docs", "updated_at"].includes(key)));
    assert.deepEqual(stable(after.find(row => row.id === a.id)), stable(before.find(row => row.id === a.id)));
    const target = new EventTarget();
    unregister = registerProvider(() => ({ view: { filters: { tag: "literal" } }, editors: [
      { kind: "entry-new", object_id: null, dirty: true, fields: { counterparty: "New entry draft ñ" } },
      { kind: "entry-document", object_id: a.id, dirty: true, fields: { doc_ref: "hoard://kafka/document/next", label: "Pending ñ", saved_docs: empty.body.docs } },
    ] }), target);
    const context = await buildContext({ hash: "#/movimientos", ...collectContext(target), getEntry: async id => getEntry(id), getState: async () => ({ accounts: [account], categories: [] }) });
    assert.equal(context.view.editor.kind, "entry-document"); assert.equal(context.view.editor.fields.label, "Pending ñ");
    assert.deepEqual(context.active_objects.find(object => object.object_id === a.id).docs, empty.body.docs);
    assert.equal(context.view.editors.find(editor => editor.kind === "entry-new").fields.counterparty, "New entry draft ñ");
    assert.equal(context.active_objects.some(object => object.object_id === b.id), false);
  } finally { unregister?.(); setFamilyApi(null); await server.stop(); }
});
