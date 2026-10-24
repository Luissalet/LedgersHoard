import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { formatCents } from "../format.js";
import { useCopilotContext } from "../copilot-hooks.js";
import { draftFromEntry } from "./EntryRow.jsx";
import { Field } from "./ui.jsx";

export default function EntryRepeatDialog({ entry, accounts, categories, onClose, onCreated }) {
  const dialog = useRef(null), alive = useRef(false);
  const [draft, setDraft] = useState(() => ({ ...draftFromEntry(entry), tags: [...(entry.tags || [])] }));
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [accepted, setAccepted] = useState(null);
  const current = useRef(null);
  current.current = { ...draft, tags: tag.trim() ? [...draft.tags, tag] : draft.tags };
  useEffect(() => {
    alive.current = true; dialog.current.showModal();
    return () => { alive.current = false; };
  }, []);
  const currency = accounts.find(account => account.id === entry.account_id)?.currency || "Moneda no disponible";
  const selectedCurrency = accounts.find(account => account.id === draft.account_id)?.currency || "Moneda no disponible";
  useCopilotContext(() => ({ editors: [{ kind: "entry-new", object_id: null, dirty: true,
    fields: current.current, source_entry_id: entry.id, accepted_entry_id: accepted?.id || null }] }));
  const edit = key => event => { setError(""); setDraft(value => ({ ...value, [key]: event.target.value })); };
  const addTag = () => {
    if (!tag.trim()) return;
    setDraft(value => ({ ...value, tags: [...value.tags, tag] })); setTag(""); setError("");
  };
  const save = async event => {
    event.preventDefault();
    const sent = { ...current.current, tags: [...current.current.tags] };
    setBusy(true); setError(""); setAccepted(null);
    try {
      const created = await api.entries.create(sent);
      onCreated(created);
      if (!alive.current) return;
      if (JSON.stringify(sent) === JSON.stringify(current.current)) onClose();
      else setAccepted(created);
    } catch (failure) {
      if (alive.current) setError(failure.message);
    } finally { if (alive.current) setBusy(false); }
  };
  return <dialog ref={dialog} className="m-auto max-h-[calc(100dvh-32px)] overflow-y-auto" onClose={onClose} aria-labelledby="entry-repeat-title">
    <h2 id="entry-repeat-title" className="text-[19px] font-semibold">Nuevo movimiento a partir de otro</h2>
    <p className="mt-2 break-words text-[13px]">{entry.counterparty || "Sin concepto"} · {entry.date} · {formatCents(entry.amount_cents, currency)}</p>
    <p className="help mt-1 break-all">Original: {entry.id}</p>
    <p className="help mt-3">Revisa la fecha y los campos antes de añadirlo. El original y tu entrada rápida se conservan. Se crea un movimiento manual nuevo, sin documentos, datos de importación ni repartos del original.</p>
    <form onSubmit={save} className="mt-4 space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Fecha del nuevo movimiento" help="Inicialmente es la fecha del original."><input autoFocus type="date" className="field" value={draft.date} onChange={edit("date")} required /></Field>
        <Field label={`Importe (${selectedCurrency})`} help="Negativo para gasto, positivo para ingreso; no convierte monedas."><input className="field num" inputMode="decimal" value={draft.amount} onChange={edit("amount")} required /></Field>
        <Field label="Cuenta del nuevo movimiento"><select className="field" value={draft.account_id} onChange={edit("account_id")} required>
          {accounts.filter(account => !account.archived || account.id === draft.account_id).map(account => <option key={account.id} value={account.id}>{account.name}{account.archived ? " (archivada)" : ""}</option>)}
        </select></Field>
        <Field label="Categoría del nuevo movimiento"><select className="field" value={draft.category_id || ""} onChange={event => { setError(""); setDraft(value => ({ ...value, category_id: event.target.value || null })); }}>
          <option value="">Sin categoría</option>
          {categories.filter(category => !category.archived || category.id === draft.category_id).map(category => <option key={category.id} value={category.id}>{category.name}{category.archived ? " (archivada)" : ""}</option>)}
        </select></Field>
      </div>
      <Field label="Concepto del nuevo movimiento"><input className="field" value={draft.counterparty} onChange={edit("counterparty")} maxLength={200} /></Field>
      <Field label="Nota del nuevo movimiento"><textarea className="field" rows={2} value={draft.note} onChange={edit("note")} maxLength={2000} /></Field>
      <fieldset className="space-y-2">
        <legend className="label">Etiquetas del nuevo movimiento</legend>
        <p className="help">Cada etiqueta es un texto completo; las comas y espacios forman parte de ella.</p>
        {draft.tags.map((value, index) => <div key={index} className="flex items-end gap-2">
          <Field label={`Etiqueta ${index + 1}`} className="min-w-0 flex-1"><input className="field" value={value} maxLength={40} onChange={event => { setError(""); setDraft(previous => ({ ...previous, tags: previous.tags.map((item, position) => position === index ? event.target.value : item) })); }} /></Field>
          <button type="button" className="btn" aria-label={`Quitar etiqueta ${index + 1}`} onClick={() => setDraft(previous => ({ ...previous, tags: previous.tags.filter((_, position) => position !== index) }))}>Quitar</button>
        </div>)}
        <div className="flex items-end gap-2">
          <Field label="Otra etiqueta" className="min-w-0 flex-1"><input className="field" value={tag} maxLength={40} onChange={event => { setError(""); setTag(event.target.value); }} /></Field>
          <button type="button" className="btn" onClick={addTag} disabled={!tag.trim()}>Añadir etiqueta</button>
        </div>
      </fieldset>
      {error && <p role="alert" className="text-[13px]" style={{ color: "var(--danger-ink)" }}>{error}</p>}
      {accepted && <p role="status" className="break-words text-[13px]">Movimiento creado: <span className="break-all">{accepted.id}</span> · {accepted.date} · {formatCents(accepted.amount_cents, accounts.find(account => account.id === accepted.account_id)?.currency || selectedCurrency)}. Los cambios posteriores siguen en el formulario sin añadir.</p>}
      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <button type="button" className="btn" onClick={onClose}>Cancelar</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Añadiendo…" : "Añadir movimiento"}</button>
      </div>
    </form>
  </dialog>;
}
