import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { Page, Section, Empty, ConfirmDialog, useAction, Field } from "../components/ui.jsx";
import { EntryRow, EntryFields, EntryForm, emptyDraft } from "../components/EntryRow.jsx";
import { formatCents, today, thisMonth } from "../format.js";

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

export default function Movimientos() {
  const { accounts, categories, settings, refresh, notify } = useApp();
  const symbol = settings?.currency_symbol || "€";
  const [filter, setFilter] = useState({ from: `${thisMonth()}-01`, to: "", account: "", category: "", text: "" });
  const [result, setResult] = useState({ items: [], total: 0 });
  const [draft, setDraft] = useState(() => emptyDraft({ date: today(), account_id: accounts.find((a) => !a.archived)?.id || "" }));
  const [pendingDelete, setPendingDelete] = useState(null);
  const [showTransfer, setShowTransfer] = useState(false);
  const [run, busy] = useAction(notify);
  const activeAccounts = accounts.filter((a) => !a.archived);

  const load = useCallback(async () => {
    try {
      setResult(await api.entries.list({ ...filter, limit: 300 }));
    } catch (e) {
      notify({ kind: "error", text: e.message });
    }
  }, [filter, notify]);
  useEffect(() => { load(); }, [load]);

  const setF = (k) => (e) => setFilter((f) => ({ ...f, [k]: e.target.value }));

  const toPayload = (d) => ({
    date: d.date, amount: d.amount, account_id: d.account_id, category_id: d.category_id || null, counterparty: d.counterparty, note: d.note,
  });

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

  const sum = result.items.reduce((s, e) => s + e.amount_cents, 0);

  return (
    <Page
      title="Movimientos"
      description="Apunta gastos e ingresos en la fila superior: importe negativo para gasto, positivo para ingreso. Enter guarda, Escape cancela."
      actions={<button type="button" className="btn" onClick={() => setShowTransfer((v) => !v)} aria-expanded={showTransfer}>Traspaso entre cuentas</button>}
    >
      {showTransfer && <div className="mb-4"><TransferForm accounts={activeAccounts} run={run} busy={busy} onDone={() => { setShowTransfer(false); load(); refresh(); }} /></div>}
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-[150px_150px_1fr_1fr_1fr]">
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
        <input className="field field-sm col-span-2 md:col-span-1" placeholder="Buscar concepto o nota" value={filter.text} onChange={setF("text")} aria-label="Buscar" />
      </div>
      <Section aside={<span className="help num">{result.total} movimientos · suma {formatCents(sum, symbol)}</span>} title="Listado">
        {!activeAccounts.length ? (
          <Empty text="Necesitas una cuenta antes de apuntar movimientos." action={<a href="#/cuentas" className="btn btn-primary">Crear cuenta</a>} />
        ) : (
          <div className="-mx-2 overflow-x-auto">
            <div className="mb-3 px-2 md:hidden">
              <EntryForm draft={draft} setDraft={setDraft} accounts={activeAccounts} categories={categories} onSubmit={add} submitLabel="Añadir" busy={busy} />
            </div>
            <table className="table table-fixed min-w-[760px]">
              <colgroup>
                <col className="w-[138px]" /><col className="w-[92px]" /><col className="w-[132px]" /><col className="w-[144px]" /><col />
                <col className="hidden lg:table-column" /><col className="w-[152px]" />
              </colgroup>
              <thead>
                <tr><th>Fecha</th><th>Importe</th><th>Cuenta</th><th>Categoría</th><th>Concepto</th><th className="hidden lg:table-cell">Nota</th><th></th></tr>
              </thead>
              <tbody>
                <tr className="hidden md:table-row" style={{ background: "var(--soft)" }}>
                  <EntryFields draft={draft} setDraft={setDraft} accounts={activeAccounts} categories={categories} onSubmit={add} submitLabel="Añadir" busy={busy} />
                </tr>
                {result.items.map((e) => (
                  <EntryRow key={e.id} entry={e} accounts={accounts} categories={categories} symbol={symbol} onSave={save} onDelete={setPendingDelete} busy={busy} />
                ))}
              </tbody>
            </table>
            {!result.items.length && <p className="help p-4 text-center">No hay movimientos con estos filtros.</p>}
          </div>
        )}
      </Section>
      <ConfirmDialog
        open={!!pendingDelete}
        title="Borrar movimiento"
        text={pendingDelete ? `${pendingDelete.counterparty || "Sin concepto"} · ${formatCents(pendingDelete.amount_cents, symbol)}${pendingDelete.transfer_id ? " (se borran las dos mitades del traspaso)" : ""}. Esta acción no se puede deshacer.` : ""}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </Page>
  );
}
