import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { Page, Section, Empty, ConfirmDialog, useAction, Field } from "../components/ui.jsx";
import { EntryRow, EntryFields, EntryForm, emptyDraft } from "../components/EntryRow.jsx";
import SplitDialog from "../components/SplitDialog.jsx";
import PaymentLookup from "../components/PaymentLookup.jsx";
import EntryTagsDialog from "../components/EntryTagsDialog.jsx";
import EntryDocumentsDialog from "../components/EntryDocumentsDialog.jsx";
import { formatCents, today, thisMonth } from "../format.js";
import { useCopilotContext, useCopilotRefresh } from "../copilot-hooks.js";

function TransferForm({ accounts, onDone, run, busy }) {
  const [form, setForm] = useState({ from: "", to: "", amount: "", date: today(), note: "" });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    const out = await run(() => api.transfer({ from_account_id: form.from, to_account_id: form.to, amount_cents: null, amount: form.amount, date: form.date, note: form.note }), "Traspaso registrado.");
    if (out) onDone();
  };
  return (
    <form onSubmit={submit} className="panel grid gap-3 sm:grid-cols-[1fr_1fr_120px_150px_1fr_auto] sm:items-end">
      <Field label="Desde"><select className="field field-sm" value={form.from} onChange={set("from")} required><option value="">Cuenta…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
      <Field label="Hasta"><select className="field field-sm" value={form.to} onChange={set("to")} required><option value="">Cuenta…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
      <Field label="Importe"><input className="field field-sm num" inputMode="decimal" placeholder="200" value={form.amount} onChange={set("amount")} required /></Field>
      <Field label="Fecha"><input type="date" className="field field-sm" value={form.date} onChange={set("date")} required /></Field>
      <Field label="Nota"><input className="field field-sm" value={form.note} onChange={set("note")} /></Field>
      <button type="submit" className="btn btn-primary" disabled={busy}>Mover</button>
    </form>
  );
}

/** Filters carried in the hash, e.g. #/movimientos?text=Netflix&from=2026-10-01&to=2026-10-31 (links from Correo). */
function hashFilter() {
  const query = window.location.hash.split("?")[1];
  if (!query) return null;
  const params = new URLSearchParams(query);
  const out = {};
  for (const k of ["from", "to", "account", "category", "text", "tag"]) if (params.has(k)) out[k] = params.get(k);
  return Object.keys(out).length ? out : null;
}

/** #/movimientos?tx=<id>: the link another app uses to point at one movement. */
const hashTx = () => new URLSearchParams(window.location.hash.split("?")[1] || "").get("tx") || "";
const PAGE_SIZE = 100;
const EMPTY_RESULT = { items: [], total: 0, nextOffset: null };
const appliedFilters = (filter) => Object.fromEntries(Object.entries(filter)
  .map(([key, value]) => [key, key === "tag" || key === "text" ? value.trim() : value]).filter(([, value]) => value));

export default function Movimientos() {
  const { accounts, categories, refresh, notify } = useApp();
  const [filter, setFilter] = useState(() => ({ from: `${thisMonth()}-01`, to: "", account: "", category: "", text: "", tag: "", ...(hashFilter() || {}) }));
  const [storedResult, setResult] = useState(EMPTY_RESULT);
  const [request, setRequest] = useState(null);
  const generation = useRef(0);
  const [draft, setDraft] = useState(() => emptyDraft({ date: today(), account_id: accounts.find((a) => !a.archived)?.id || "" }));
  const [pendingDelete, setPendingDelete] = useState(null);
  const [showTransfer, setShowTransfer] = useState(false);
  const [tx, setTx] = useState(hashTx);
  const [splitting, setSplitting] = useState(null);
  const [tagging, setTagging] = useState(null);
  const [documenting, setDocumenting] = useState(null);
  const [run, busy] = useAction(notify);
  const activeAccounts = accounts.filter((a) => !a.archived);
  const queryKey = JSON.stringify({ filter, tx });
  const result = storedResult.key === queryKey ? storedResult : EMPTY_RESULT;
  const currentRequest = request?.key === queryKey ? request : null;
  const loading = currentRequest?.loading;
  const currencyOf = (entry) => accounts.find((a) => a.id === entry?.account_id)?.currency || "Moneda no disponible";

  const fetchPage = useCallback(async (offset = 0, append = false) => {
    const ticket = ++generation.current;
    setRequest({ key: queryKey, loading: true, append });
    try {
      const one = tx ? await api.entries.get(tx) : null;
      const page = tx ? { items: one ? [one] : [], total: one ? 1 : 0, nextOffset: null }
        : await api.entries.list({ ...filter, limit: PAGE_SIZE, offset });
      if (ticket !== generation.current) return;
      setResult((previous) => ({ ...page, key: queryKey, filters: tx ? null : appliedFilters(filter), items: append && previous.key === queryKey ? [...previous.items, ...page.items] : page.items }));
      setRequest(null);
    } catch (e) {
      if (ticket === generation.current) setRequest({ key: queryKey, loading: false, append, offset, error: e.message });
    }
  }, [filter, tx, queryKey]);
  const load = useCallback(() => fetchPage(), [fetchPage]);
  const tagsRefresh = useRef(load);
  tagsRefresh.current = load;
  const documentsRefresh = useRef(load);
  documentsRefresh.current = load;
  useEffect(() => { load(); return () => { generation.current++; }; }, [load]);
  useEffect(() => {
    const onHash = () => {
      setTx(hashTx());
      const f = hashFilter();
      if (f) setFilter((cur) => ({ ...cur, to: "", text: "", tag: "", ...f }));
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const setF = (k) => (e) => setFilter((f) => ({ ...f, [k]: e.target.value }));
  useCopilotRefresh(() => { load(); });
  useCopilotContext(() => {
    const filters = Object.fromEntries(Object.entries(filter).filter(([, v]) => v));
    const typed = !!(draft.amount.trim() || draft.counterparty.trim() || draft.note.trim());
    return {
      view: { filters, ...(tx ? { tx } : {}), listing: {
        status: loading ? "loading" : currentRequest?.error ? "error" : storedResult.key === queryKey ? "ready" : "pending",
        applied_filters: result.key === queryKey ? result.filters : null,
        loaded_ids: result.items.map((entry) => entry.id), total: result.key === queryKey ? result.total : null,
      } },
      editors: typed ? [{ kind: "entry-new", object_id: null, dirty: true, fields: draft }] : [],
    };
  });

  // Works for a whole draft (new entry) and for the changed fields only (edit): an agent's concurrent change to another field survives.
  const toPayload = (d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, k === "category_id" ? (v || null) : v]));

  const add = async () => {
    if (!draft.amount.trim()) return notify({ kind: "error", text: "Escribe un importe (negativo = gasto)." });
    if (!draft.account_id) return notify({ kind: "error", text: "Elige una cuenta." });
    const out = await run(() => api.entries.create(toPayload(draft)), "Movimiento apuntado.");
    if (out) {
      setDraft((d) => ({ ...d, amount: "", counterparty: "", note: "" }));
      await Promise.all([load(), refresh()]);
    }
  };

  const save = async (id, d) => {
    const out = await run(() => api.entries.update(id, toPayload(d)), "Guardado.");
    if (out) await Promise.all([load(), refresh()]);
    return !!out;
  };

  const confirmDelete = async () => {
    const e = pendingDelete;
    setPendingDelete(null);
    const out = await run(() => api.entries.remove(e.id), "Movimiento borrado.");
    if (out) await Promise.all([load(), refresh()]);
  };

  const openDoc = async (doc) => {
    const out = await run(() => api.entries.docLink(doc.ref));
    if (out?.url) window.open(out.url, "_blank", "noopener");
    else if (out) notify({ kind: "error", text: out.error || "No se pudo abrir el documento: la app que lo guarda no responde." });
  };
  const showAll = () => { setTx(""); window.location.hash = "#/movimientos"; };

  const sums = new Map();
  for (const entry of result.items) {
    const currency = currencyOf(entry);
    sums.set(currency, (sums.get(currency) || 0) + entry.amount_cents);
  }

  return (
    <Page
      title="Movimientos"
      description="Apunta gastos e ingresos en la fila superior: importe negativo para gasto, positivo para ingreso. Enter guarda, Escape cancela."
      actions={<button type="button" className="btn" onClick={() => setShowTransfer((v) => !v)} aria-expanded={showTransfer}>Traspaso entre cuentas</button>}
    >
      {tx && (
        <div className="panel mb-4 flex flex-wrap items-center justify-between gap-2 text-[13px]" role="status">
          <span>Mostrando un solo movimiento, el que enlaza otra app.</span>
          <button type="button" className="btn btn-sm" onClick={showAll}>Ver todos</button>
        </div>
      )}
      {showTransfer && <div className="mb-4"><TransferForm accounts={activeAccounts} run={run} busy={busy} onDone={() => { setShowTransfer(false); load(); refresh(); }} /></div>}
      <PaymentLookup accounts={accounts} />
      {!tx && <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-[150px_150px_1fr_1fr_1fr]">
        <input type="date" className="field field-sm" value={filter.from} onChange={setF("from")} aria-label="Desde" />
        <input type="date" className="field field-sm" value={filter.to} onChange={setF("to")} aria-label="Hasta" />
        <select className="field field-sm" value={filter.account} onChange={setF("account")} aria-label="Filtrar por cuenta">
          <option value="">Todas las cuentas</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select className="field field-sm" value={filter.category} onChange={setF("category")} aria-label="Filtrar por categoría">
          <option value="">Todas las categorías</option>
          <option value="none">Sin categoría</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input className="field field-sm col-span-2 md:col-span-1" placeholder="Buscar concepto, nota o etiqueta" value={filter.text} onChange={setF("text")} aria-label="Buscar" />
        <div className="col-span-2 md:col-span-5">
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 grow sm:max-w-sm" htmlFor="entries-tag-filter">
              <span className="mb-1 block text-[13px]">Etiquetas (coincidencia parcial)</span>
              <input id="entries-tag-filter" className="field field-sm w-full" maxLength={40} value={filter.tag}
                onChange={setF("tag")} aria-describedby="entries-tag-help" placeholder="Por ejemplo: Viaje 2026" />
            </label>
            {filter.tag && <button type="button" className="btn btn-sm" onClick={() => setFilter((f) => ({ ...f, tag: "" }))}>Quitar filtro de etiquetas</button>}
          </div>
          <p id="entries-tag-help" className="help mt-1">Busca sólo dentro de las etiquetas guardadas, no en notas o conceptos. Es parcial: % admite varios caracteres y _ uno. Se combina con los demás filtros.</p>
        </div>
      </div>}
      <Section aside={<span className="help num" role="status">Cargados {result.items.length} de {result.total} movimientos</span>} title="Listado">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div className="help">
            <p>Suma de los cargados: {sums.size ? [...sums].map(([currency, sum]) => <span className="num mr-3 inline-block" key={currency}>{formatCents(sum, currency)}</span>) : "—"}</p>
            <p>Importes por moneda de la cuenta, sin conversión. Incluye las filas de traspasos cargadas.</p>
          </div>
          <button type="button" className="btn btn-sm" onClick={load} disabled={loading || busy}>Actualizar listado</button>
        </div>
        {!activeAccounts.length ? (
          <Empty text="Necesitas una cuenta antes de apuntar movimientos." action={<a href="#/cuentas" className="btn btn-primary">Crear cuenta</a>} />
        ) : (
          <div className="-mx-2 overflow-x-auto">
            <div className="mb-3 px-2 md:hidden">
              <EntryForm draft={draft} setDraft={setDraft} accounts={activeAccounts} categories={categories} onSubmit={add} submitLabel="Añadir" busy={busy} />
            </div>
            <table className="table table-fixed min-w-[980px]">
              <colgroup>
                <col className="w-[138px]" /><col className="w-[92px]" /><col className="w-[132px]" /><col className="w-[144px]" /><col />
                <col className="hidden lg:table-column" /><col className="w-[310px]" />
              </colgroup>
              <thead>
                <tr><th>Fecha</th><th>Importe</th><th>Cuenta</th><th>Categoría</th><th>Concepto</th><th className="hidden lg:table-cell">Nota</th><th></th></tr>
              </thead>
              <tbody>
                <tr className="hidden md:table-row" style={{ background: "var(--soft)" }}>
                  <EntryFields draft={draft} setDraft={setDraft} accounts={activeAccounts} categories={categories} onSubmit={add} submitLabel="Añadir" busy={busy} />
                </tr>
                {result.items.map((e) => (
                  <EntryRow key={e.id} entry={e} accounts={accounts} categories={categories} symbol={currencyOf(e)} onSave={save} onDelete={setPendingDelete} onSplit={setSplitting} onTags={setTagging} onDocuments={setDocumenting} onOpenDoc={openDoc} highlight={!!tx} busy={busy} />
                ))}
              </tbody>
            </table>
            {!result.items.length && !loading && !currentRequest?.error && <p className="help p-4 text-center">No hay movimientos con estos filtros.</p>}
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-3">
          <div className="help" aria-live="polite">
            {loading ? <p>{currentRequest.append ? "Cargando más movimientos…" : "Cargando listado…"}</p> : <p>{result.nextOffset !== null ? "Puedes continuar con los siguientes movimientos." : result.items.length ? "Has llegado al final del listado cargado." : ""}</p>}
            {!tx && <p>Si se añaden o borran movimientos mientras cargas páginas, actualiza para empezar de nuevo.</p>}
            {currentRequest?.error && <p role="alert">No se pudo cargar el listado: {currentRequest.error}</p>}
          </div>
          {currentRequest?.error ? <button type="button" className="btn" onClick={() => fetchPage(currentRequest.offset, currentRequest.append)} disabled={busy}>Reintentar</button>
            : !tx && result.nextOffset !== null && <button type="button" className="btn" onClick={() => fetchPage(result.nextOffset, true)} disabled={loading || busy}>Cargar más movimientos</button>}
        </div>
      </Section>
      <SplitDialog entry={splitting} symbol={currencyOf(splitting)} run={run} busy={busy} onClose={() => setSplitting(null)} onDone={(out) => { if (out) setSplitting(null); load(); }} />
      {tagging && <EntryTagsDialog key={tagging.id} entry={result.items.find((entry) => entry.id === tagging.id) || tagging} currency={currencyOf(tagging)} onClose={() => setTagging(null)} onSaved={() => { tagsRefresh.current(); refresh(); }} />}
      {documenting && <EntryDocumentsDialog key={documenting.id} entry={result.items.find((entry) => entry.id === documenting.id) || documenting} currency={currencyOf(documenting)} onClose={() => setDocumenting(null)} onSaved={() => { documentsRefresh.current(); refresh(); }} />}
      <ConfirmDialog
        open={!!pendingDelete}
        title="Borrar movimiento"
        text={pendingDelete ? `${pendingDelete.counterparty || "Sin concepto"} · ${formatCents(pendingDelete.amount_cents, currencyOf(pendingDelete))}${pendingDelete.transfer_id ? " (se borran las dos mitades del traspaso)" : ""}. Esta acción no se puede deshacer.` : ""}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </Page>
  );
}
