import React, { useEffect, useState } from "react";
import { changedFields, rebaseForm } from "../copilot-context.js";
import { useCopilotContext } from "../copilot-hooks.js";
import { formatCents, centsToText, dateLabel } from "../format.js";

const CategorySelect = ({ value, onChange, categories, className = "" }) => (
  <select className={`field field-sm ${className}`} value={value || ""} onChange={(e) => onChange(e.target.value || null)} aria-label="Categoría">
    <option value="">Sin categoría</option>
    <optgroup label="Gastos">
      {categories.filter((c) => c.kind === "expense" && !c.archived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </optgroup>
    <optgroup label="Ingresos">
      {categories.filter((c) => c.kind === "income" && !c.archived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </optgroup>
  </select>
);

const AccountSelect = ({ value, onChange, accounts, className = "" }) => (
  <select className={`field field-sm ${className}`} value={value || ""} onChange={(e) => onChange(e.target.value)} aria-label="Cuenta">
    {!value && <option value="">Cuenta…</option>}
    {accounts.filter((a) => !a.archived || a.id === value).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
  </select>
);

/** Editable cells shared by the quick-add row and the inline editor. */
export function EntryFields({ draft, setDraft, accounts, categories, onSubmit, onCancel, submitLabel, busy, autoFocus }) {
  const set = (k) => (v) => setDraft((d) => ({ ...d, [k]: v }));
  const onKey = (e) => {
    if (e.key === "Enter") { e.preventDefault(); onSubmit(); }
    if (e.key === "Escape" && onCancel) { e.preventDefault(); onCancel(); }
  };
  return (
    <>
      <td><input type="date" className="field field-sm" value={draft.date} onChange={(e) => set("date")(e.target.value)} onKeyDown={onKey} aria-label="Fecha" autoFocus={autoFocus} /></td>
      <td><input className="field field-sm num" inputMode="decimal" placeholder="-12,50" value={draft.amount} onChange={(e) => set("amount")(e.target.value)} onKeyDown={onKey} aria-label="Importe (negativo = gasto)" /></td>
      <td><AccountSelect value={draft.account_id} onChange={set("account_id")} accounts={accounts}  /></td>
      <td><CategorySelect value={draft.category_id} onChange={set("category_id")} categories={categories}  /></td>
      <td><input className="field field-sm" placeholder="Concepto" value={draft.counterparty} onChange={(e) => set("counterparty")(e.target.value)} onKeyDown={onKey} aria-label="Concepto" /></td>
      <td className="hidden lg:table-cell"><input className="field field-sm" placeholder="Nota" value={draft.note} onChange={(e) => set("note")(e.target.value)} onKeyDown={onKey} aria-label="Nota" /></td>
      <td className="whitespace-nowrap">
        <button type="button" className="btn btn-primary btn-sm" onClick={onSubmit} disabled={busy}>{submitLabel}</button>
        {onCancel && <button type="button" className="btn btn-sm ml-1" onClick={onCancel}>Cancelar</button>}
      </td>
    </>
  );
}

/** Stacked variant of the quick-add row for narrow screens. */
export function EntryForm({ draft, setDraft, accounts, categories, onSubmit, submitLabel, busy }) {
  const set = (k) => (v) => setDraft((d) => ({ ...d, [k]: v }));
  return (
    <form className="panel grid grid-cols-2 gap-2" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      <input type="date" className="field field-sm" value={draft.date} onChange={(e) => set("date")(e.target.value)} aria-label="Fecha" required />
      <input className="field field-sm num" inputMode="decimal" placeholder="Importe: -12,50" value={draft.amount} onChange={(e) => set("amount")(e.target.value)} aria-label="Importe (negativo = gasto)" required />
      <AccountSelect value={draft.account_id} onChange={set("account_id")} accounts={accounts} />
      <CategorySelect value={draft.category_id} onChange={set("category_id")} categories={categories} />
      <input className="field field-sm col-span-2" placeholder="Concepto" value={draft.counterparty} onChange={(e) => set("counterparty")(e.target.value)} aria-label="Concepto" />
      <input className="field field-sm" placeholder="Nota" value={draft.note} onChange={(e) => set("note")(e.target.value)} aria-label="Nota" />
      <button type="submit" className="btn btn-primary" disabled={busy}>{submitLabel}</button>
    </form>
  );
}

export function emptyDraft(defaults = {}) {
  return { date: "", amount: "", account_id: "", category_id: null, counterparty: "", note: "", ...defaults };
}

export function draftFromEntry(e) {
  return { date: e.date, amount: centsToText(e.amount_cents), account_id: e.account_id, category_id: e.category_id, counterparty: e.counterparty, note: e.note };
}

/** One entry: read-only row that switches to the inline editor. */
export function EntryRow({ entry, accounts, categories, symbol, onSave, onDelete, onSplit, onTags, onOpenDoc, highlight, busy }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => draftFromEntry(entry));
  const [base, setBase] = useState(null);   // the entry as it was when editing began: only fields the user changed are saved
  const start = () => { const from = draftFromEntry(entry); setBase(from); setDraft(from); setEditing(true); };
  const changed = editing && base ? changedFields(base, draft) : {};
  // The entry reloaded under the editor (an agent changed it): untouched fields follow it, typed ones stay.
  const entryKey = JSON.stringify(draftFromEntry(entry));
  useEffect(() => {
    if (!editing || !base) return;
    const next = draftFromEntry(entry);
    if (JSON.stringify(next) === JSON.stringify(base)) return;
    setDraft((d) => rebaseForm(base, next, d));
    setBase(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryKey]);
  useCopilotContext(() => ({ editors: editing ? [{ kind: "entry-form", object_id: entry.id, dirty: Object.keys(changed).length > 0, fields: draft, changed }] : [] }));
  const save = async () => {
    if (!Object.keys(changed).length) { setEditing(false); return; }
    const ok = await onSave(entry.id, changed);
    if (ok) setEditing(false);
  };
  if (editing) {
    return (
      <tr>
        <EntryFields draft={draft} setDraft={setDraft} accounts={accounts} categories={categories} onSubmit={save} onCancel={() => setEditing(false)} submitLabel="Guardar" busy={busy} autoFocus />
      </tr>
    );
  }
  const isTransfer = !!entry.transfer_id;
  return (
    <tr style={highlight ? { background: "var(--soft)" } : undefined} data-entry={entry.id}>
      <td className="num whitespace-nowrap">{dateLabel(entry.date)}</td>
      <td className={`num whitespace-nowrap font-semibold ${entry.amount_cents < 0 ? "expense" : "income"}`}>{formatCents(entry.amount_cents, symbol)}</td>
      <td>{entry.account_name}</td>
      <td>{isTransfer ? <span className="chip">Traspaso</span> : entry.category_name || <span className="help">—</span>}</td>
      <td><div className="truncate" title={entry.counterparty}>{entry.counterparty || <span className="help">(sin concepto)</span>}
        {entry.source !== "manual" && <span className="chip ml-2">{entry.source === "agent" ? "asistente" : entry.source === "mail" ? "correo" : "importado"}</span>}
        {(entry.docs || []).map((d) => (
          <button key={d.ref} type="button" className="chip chip-income ml-2" title={`Abrir ${d.ref}`} onClick={() => onOpenDoc && onOpenDoc(d)}>{d.label || "Documento"}</button>
        ))}</div>
        {entry.tags?.length > 0 && <div className="mt-1 flex flex-wrap gap-1" aria-label="Etiquetas guardadas">
          {entry.tags.map((tag, index) => <span key={index} className="chip max-w-full break-words whitespace-normal">{tag}</span>)}
        </div>}
      </td>
      <td className="hidden truncate lg:table-cell" title={entry.note}>{entry.note}</td>
      <td className="whitespace-nowrap">
        {onTags && !isTransfer && <button type="button" className="btn btn-sm mr-1" onClick={() => onTags(entry)}>Etiquetas</button>}
        {onSplit && entry.amount_cents < 0 && !isTransfer && <button type="button" className="btn btn-sm mr-1" onClick={() => onSplit(entry)} title="Repartir este gasto con otras personas">Repartir</button>}
        <button type="button" className="btn btn-sm" onClick={start} disabled={isTransfer} title={isTransfer ? "Los traspasos se borran y se vuelven a crear" : "Editar"}>Editar</button>
        <button type="button" className="btn btn-danger btn-sm ml-1" onClick={() => onDelete(entry)}>Borrar</button>
      </td>
    </tr>
  );
}
