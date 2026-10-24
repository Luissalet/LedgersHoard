import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { formatCents } from "../format.js";
import { useCopilotContext } from "../copilot-hooks.js";
import { rebaseForm } from "../copilot-context.js";
import { Field } from "./ui.jsx";

export default function EntryDocumentsDialog({ entry, currency, onClose, onSaved }) {
  const dialog = useRef(null), alive = useRef(false), version = useRef(0);
  const [docs, setDocs] = useState(entry.docs || []);
  const [ref, setRef] = useState("");
  const [label, setLabel] = useState("");
  const [fixedRef, setFixedRef] = useState(null);
  const [baseline, setBaseline] = useState({ ref: "", label: "" });
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(null);
  const savedKey = JSON.stringify(entry.docs || []);
  const dirty = ref !== baseline.ref || label !== baseline.label;
  useEffect(() => {
    alive.current = true; dialog.current?.showModal();
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    const next = entry.docs || [];
    setDocs(next);
    const selected = fixedRef && next.find(doc => doc.ref === fixedRef);
    if (selected) {
      const nextBase = { ref: selected.ref, label: selected.label || "" };
      const rebased = rebaseForm(baseline, nextBase, { ref, label });
      setRef(rebased.ref); setLabel(rebased.label); setBaseline(nextBase);
    }
    // A native refresh follows untouched fields without resetting later typed drafts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);
  useCopilotContext(() => ({ editors: [{ kind: "entry-document", object_id: entry.id, dirty,
    fields: { doc_ref: ref, label, fixed_ref: fixedRef, saved_docs: docs } }] }));

  const edit = () => { version.current++; setMessage(null); };
  const choose = (doc) => {
    edit(); setFixedRef(doc?.ref || null); setRef(doc?.ref || ""); setLabel(doc?.label || "");
    setBaseline({ ref: doc?.ref || "", label: doc?.label || "" });
  };
  const save = async (event) => {
    event.preventDefault();
    if (!ref.trim() || busy) return;
    const ticket = version.current;
    setBusy(true); setMessage(null);
    try {
      const result = await api.entries.addDoc(entry.id, ref, label);
      // A committed write still refreshes the current listing when this dialog was closed.
      onSaved(result);
      if (!alive.current) return;
      setDocs(result.docs);
      const sameDraft = ticket === version.current;
      if (sameDraft) {
        setRef(result.doc.ref); setLabel(result.doc.label); setFixedRef(result.doc.ref);
        setBaseline({ ref: result.doc.ref, label: result.doc.label });
      }
      setMessage({ text: `${result.already ? "Referencia ya vinculada. Etiqueta guardada" : "Referencia vinculada"}: ${result.doc.label || result.doc.ref}.${sameDraft ? "" : " Quedan campos posteriores sin guardar."}` });
    } catch (error) {
      if (alive.current) setMessage({ error: true, text: error.message });
    } finally { if (alive.current) setBusy(false); }
  };

  return <dialog ref={dialog} className="m-auto max-h-[calc(100dvh-32px)] overflow-y-auto" onClose={onClose} aria-labelledby="entry-documents-title">
    <h2 id="entry-documents-title" className="text-[19px] font-semibold">Vincular documento</h2>
    <p className="mt-1 break-words text-[13px]">{entry.counterparty || "Sin concepto"} · {formatCents(entry.amount_cents, currency)}</p>
    <p className="help mt-1 break-all">Movimiento: {entry.id}</p>
    <p className="help mt-3">Guarda una referencia a un documento de otra app. No copia archivos ni comprueba que el documento exista o esté disponible. Guardar no abre la app.</p>
    <h3 className="mt-4 text-[14px] font-semibold">Referencias guardadas</h3>
    {docs.length ? <ul className="my-2 space-y-3" aria-label="Referencias guardadas">
      {docs.map(doc => <li key={doc.ref} className="text-[13px]">
        <div className="break-words">{doc.label || "Sin etiqueta"}</div>
        <div className="help [overflow-wrap:anywhere]">{doc.ref}</div>
        <button type="button" className="btn btn-sm mt-1" onClick={() => choose(doc)} aria-label={`Cambiar etiqueta de ${doc.label || doc.ref}`}>Cambiar etiqueta</button>
      </li>)}
    </ul> : <p className="help mt-2">Este movimiento no tiene referencias guardadas.</p>}
    <form onSubmit={save} className="mt-4 space-y-3">
      <Field label="Referencia del documento" help={fixedRef ? "La referencia queda fija al cambiar su etiqueta. Para añadir otra, usa Nuevo vínculo." : "Formato hoard://app/tipo/id. Hasta 400 caracteres, sin espacios."}>
        <input className="field min-w-0" value={ref} readOnly={fixedRef !== null} maxLength={400} required autoFocus
          placeholder="hoard://kafka/document/id" onChange={event => { edit(); setRef(event.target.value); }} />
      </Field>
      <Field label="Etiqueta (opcional)" help="Hasta 160 caracteres. Vacía conserva la etiqueta anterior si la referencia ya existe.">
        <input className="field min-w-0" value={label} maxLength={160} onChange={event => { edit(); setLabel(event.target.value); }} />
      </Field>
      {message && <p className={`text-[13px] [overflow-wrap:anywhere] ${message.error ? "expense" : "help"}`} role={message.error ? "alert" : "status"}>{message.text}</p>}
      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <button type="button" className="btn" onClick={() => choose(null)}>Nuevo vínculo</button>
        <button type="button" className="btn" onClick={() => dialog.current?.close()}>Cerrar</button>
        <button type="submit" className="btn btn-primary" disabled={busy || !ref.trim() || !dirty}>{busy ? "Guardando referencia…" : "Guardar referencia"}</button>
      </div>
    </form>
  </dialog>;
}
