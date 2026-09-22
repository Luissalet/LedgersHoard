import React, { useState } from "react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { Page, Section, Field, useAction, ConfirmDialog } from "../components/ui.jsx";
import { formatCents, centsToText, parseAmount, KINDS } from "../format.js";

/** Budget cell: click to edit, blur/Enter saves immediately, Escape cancels. */
function BudgetCell({ category, onSave, symbol }) {
  const [text, setText] = useState(null);
  if (category.kind !== "expense") return <span className="help">—</span>;
  if (text === null) {
    return (
      <button type="button" className="btn-link num" onClick={() => setText(category.monthly_budget == null ? "" : centsToText(category.monthly_budget))} aria-label={`Editar presupuesto de ${category.name}`}>
        {category.monthly_budget == null ? "Sin presupuesto" : formatCents(category.monthly_budget, symbol)}
      </button>
    );
  }
  const commit = async () => {
    const value = text.trim() === "" ? null : Math.abs(parseAmount(text) ?? NaN);
    if (Number.isNaN(value)) return;
    setText(null);
    if (value !== category.monthly_budget) await onSave(category.id, { monthly_budget: value });
  };
  return (
    <input
      className="field field-sm num w-[110px]"
      inputMode="decimal"
      value={text}
      autoFocus
      placeholder="250"
      aria-label={`Presupuesto mensual de ${category.name}`}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setText(null); }}
    />
  );
}

function NewCategoryForm({ categories, onCreate, busy }) {
  const [form, setForm] = useState({ name: "", kind: "expense", parent_id: "", monthly_budget: "", color: "#8a5a19" });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    const budget = form.monthly_budget.trim() ? Math.abs(parseAmount(form.monthly_budget) ?? NaN) : null;
    if (Number.isNaN(budget)) return;
    const ok = await onCreate({ name: form.name, kind: form.kind, parent_id: form.parent_id || null, monthly_budget: form.kind === "expense" ? budget : null, color: form.color });
    if (ok) setForm((f) => ({ ...f, name: "", monthly_budget: "", parent_id: "" }));
  };
  return (
    <form onSubmit={submit} className="panel grid gap-3 sm:grid-cols-[2fr_1fr_1fr_1fr_60px_auto] sm:items-end">
      <Field label="Nombre"><input className="field" value={form.name} onChange={set("name")} required maxLength={80} placeholder="Nueva categoría" /></Field>
      <Field label="Tipo"><select className="field" value={form.kind} onChange={set("kind")}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Dentro de">
        <select className="field" value={form.parent_id} onChange={set("parent_id")}>
          <option value="">(ninguna)</option>
          {categories.filter((c) => c.kind === form.kind && !c.parent_id && !c.archived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Presupuesto/mes"><input className="field num" inputMode="decimal" value={form.monthly_budget} onChange={set("monthly_budget")} disabled={form.kind !== "expense"} placeholder="250" /></Field>
      <Field label="Color"><input type="color" className="field h-[38px] p-1" value={form.color} onChange={set("color")} /></Field>
      <button type="submit" className="btn btn-primary" disabled={busy}>Crear</button>
    </form>
  );
}

export default function Categorias() {
  const { categories, settings, refresh, notify } = useApp();
  const symbol = settings?.currency_symbol || "€";
  const [run, busy] = useAction(notify);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [name, setName] = useState("");

  const update = async (id, patch, okText = "Categoría actualizada.") => {
    const out = await run(() => api.categories.update(id, patch), okText);
    if (out) refresh();
    return !!out;
  };
  const create = async (data) => {
    const out = await run(() => api.categories.create(data), "Categoría creada.");
    if (out) refresh();
    return !!out;
  };
  const remove = async () => {
    const c = pendingDelete;
    setPendingDelete(null);
    const out = await run(() => api.categories.remove(c.id), "Categoría borrada.");
    if (out) refresh();
  };

  // Tree-ish order: parents followed by their children, per kind.
  const ordered = (kind) => {
    const list = categories.filter((c) => c.kind === kind);
    const roots = list.filter((c) => !c.parent_id || !list.some((p) => p.id === c.parent_id));
    return roots.flatMap((r) => [{ ...r, depth: 0 }, ...list.filter((c) => c.parent_id === r.id).map((c) => ({ ...c, depth: 1 }))]);
  };

  const row = (c) => (
    <tr key={c.id} style={c.archived ? { opacity: 0.55 } : undefined}>
      <td>
        <span className="inline-flex items-center gap-2" style={{ paddingLeft: c.depth ? 18 : 0 }}>
          <input type="color" value={c.color || "#7a7a7a"} aria-label={`Color de ${c.name}`} className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0" onChange={(e) => update(c.id, { color: e.target.value }, null)} />
          {renaming === c.id ? (
            <input className="field field-sm" value={name} autoFocus aria-label="Nuevo nombre" onChange={(e) => setName(e.target.value)}
              onBlur={() => { setRenaming(null); if (name.trim() && name !== c.name) update(c.id, { name: name.trim() }); }}
              onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") { setName(c.name); setRenaming(null); } }} />
          ) : (
            <button type="button" className="btn-link" style={{ color: "var(--ink)" }} onClick={() => { setName(c.name); setRenaming(c.id); }} title="Renombrar">{c.name}</button>
          )}
          {c.archived && <span className="chip">Archivada</span>}
        </span>
      </td>
      <td className="num"><BudgetCell category={c} onSave={(id, patch) => update(id, patch, "Presupuesto guardado.")} symbol={symbol} /></td>
      <td className="whitespace-nowrap text-right">
        <button type="button" className="btn btn-sm" onClick={() => update(c.id, { archived: !c.archived }, c.archived ? "Categoría recuperada." : "Categoría archivada.")}>{c.archived ? "Recuperar" : "Archivar"}</button>
        {c.archived && <button type="button" className="btn btn-danger btn-sm ml-1" onClick={() => setPendingDelete(c)}>Borrar</button>}
      </td>
    </tr>
  );

  const table = (kind) => (
    <table className="table">
      <thead><tr><th>Nombre</th><th>{kind === "expense" ? "Presupuesto mensual" : ""}</th><th></th></tr></thead>
      <tbody>{ordered(kind).map(row)}</tbody>
    </table>
  );

  return (
    <Page title="Categorías" description="Pulsa un nombre para renombrarlo y un presupuesto para cambiarlo; se guarda al salir del campo. Solo las categorías de gasto tienen presupuesto.">
      <div className="mb-4"><NewCategoryForm categories={categories} onCreate={create} busy={busy} /></div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Gastos">{table("expense")}</Section>
        <Section title="Ingresos">{table("income")}</Section>
      </div>
      <ConfirmDialog open={!!pendingDelete} title="Borrar categoría" text={`Se borrará "${pendingDelete?.name}". Solo es posible si no tiene movimientos.`} onConfirm={remove} onCancel={() => setPendingDelete(null)} />
    </Page>
  );
}
