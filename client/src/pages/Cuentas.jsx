import React, { useState } from "react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { Page, Section, Empty, Field, useAction, ConfirmDialog } from "../components/ui.jsx";
import { formatCents, centsToText, parseAmount, ACCOUNT_TYPES } from "../format.js";

const blank = { name: "", type: "bank", currency: "EUR", opening_balance: "0" };

function AccountForm({ initial, onSubmit, onCancel, busy, submitLabel }) {
  const [form, setForm] = useState(initial);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = (e) => {
    e.preventDefault();
    const opening_balance = form.opening_balance.trim() ? parseAmount(form.opening_balance) : 0;
    if (opening_balance === null) return;
    onSubmit({ name: form.name, type: form.type, currency: form.currency.toUpperCase(), opening_balance });
  };
  return (
    <form onSubmit={submit} className="panel grid gap-3 sm:grid-cols-[2fr_1fr_90px_1fr_auto] sm:items-end">
      <Field label="Nombre"><input className="field" value={form.name} onChange={set("name")} required maxLength={80} placeholder="Cuenta corriente" /></Field>
      <Field label="Tipo">
        <select className="field" value={form.type} onChange={set("type")}>
          {Object.entries(ACCOUNT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Moneda"><input className="field" value={form.currency} onChange={set("currency")} maxLength={3} minLength={3} required /></Field>
      <Field label="Saldo inicial" help="Saldo real al empezar a apuntar."><input className="field num" inputMode="decimal" value={form.opening_balance} onChange={set("opening_balance")} /></Field>
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={busy}>{submitLabel}</button>
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancelar</button>}
      </div>
    </form>
  );
}

export default function Cuentas() {
  const { accounts, settings, refresh, notify } = useApp();
  const symbol = settings?.currency_symbol || "€";
  const [creating, setCreating] = useState(accounts.length === 0);
  const [editing, setEditing] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [run, busy] = useAction(notify);

  const create = async (data) => {
    const out = await run(() => api.accounts.create(data), "Cuenta creada.");
    if (out) { setCreating(false); refresh(); }
  };
  const update = async (id, data, okText = "Cuenta actualizada.") => {
    const out = await run(() => api.accounts.update(id, data), okText);
    if (out) { setEditing(null); refresh(); }
  };
  const remove = async () => {
    const a = pendingDelete;
    setPendingDelete(null);
    const out = await run(() => api.accounts.remove(a.id), "Cuenta borrada.");
    if (out) refresh();
  };

  const active = accounts.filter((a) => !a.archived);
  const archived = accounts.filter((a) => a.archived);

  const row = (a) => (
    <li key={a.id} className="py-3">
      {editing === a.id ? (
        <AccountForm initial={{ name: a.name, type: a.type, currency: a.currency, opening_balance: centsToText(a.opening_balance) }} onSubmit={(d) => update(a.id, d)} onCancel={() => setEditing(null)} busy={busy} submitLabel="Guardar" />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="font-semibold">{a.name}</span>
            <span className="chip ml-2">{ACCOUNT_TYPES[a.type] || a.type}</span>
            {a.currency !== "EUR" && <span className="chip ml-1">{a.currency}</span>}
            <div className="help text-[12px]">Saldo inicial {formatCents(a.opening_balance, a.currency === "EUR" ? symbol : a.currency)}</div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`num text-[17px] font-semibold ${a.balance < 0 ? "expense" : ""}`}>{formatCents(a.balance, a.currency === "EUR" ? symbol : a.currency)}</span>
            <button type="button" className="btn btn-sm" onClick={() => setEditing(a.id)}>Editar</button>
            <button type="button" className="btn btn-sm" onClick={() => update(a.id, { archived: !a.archived }, a.archived ? "Cuenta recuperada." : "Cuenta archivada.")}>{a.archived ? "Recuperar" : "Archivar"}</button>
            {a.archived && <button type="button" className="btn btn-danger btn-sm" onClick={() => setPendingDelete(a)}>Borrar</button>}
          </div>
        </div>
      )}
    </li>
  );

  return (
    <Page title="Cuentas" description="Efectivo, banco, tarjetas y ahorro. El saldo suma el saldo inicial y todos los movimientos." actions={!creating && <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>Nueva cuenta</button>}>
      {creating && <div className="mb-4"><AccountForm initial={blank} onSubmit={create} onCancel={accounts.length ? () => setCreating(false) : null} busy={busy} submitLabel="Crear cuenta" /></div>}
      <Section title="Activas">
        {active.length ? <ul className="divide-y" style={{ borderColor: "var(--line)" }}>{active.map(row)}</ul> : <Empty text="Crea tu primera cuenta para empezar a apuntar." action={!creating && <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>Nueva cuenta</button>} />}
      </Section>
      {archived.length > 0 && (
        <Section title="Archivadas" className="mt-4">
          <ul className="divide-y" style={{ borderColor: "var(--line)" }}>{archived.map(row)}</ul>
        </Section>
      )}
      <ConfirmDialog open={!!pendingDelete} title="Borrar cuenta" text={`Se borrará "${pendingDelete?.name}". Solo es posible si no tiene movimientos.`} onConfirm={remove} onCancel={() => setPendingDelete(null)} />
    </Page>
  );
}
