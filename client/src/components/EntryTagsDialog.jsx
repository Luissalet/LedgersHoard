import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { formatCents } from "../format.js";
import { useCopilotContext } from "../copilot-hooks.js";
import { Field } from "./ui.jsx";

/** One literal string per tag; native entry patch owns validation/normalization. */
export default function EntryTagsDialog({ entry, currency, onClose, onSaved }) {
  const dialog = useRef(null), alive = useRef(false), version = useRef(0);
  const [tags, setTags] = useState(entry.tags || []);
  const [baseline, setBaseline] = useState(entry.tags || []);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const savedKey = JSON.stringify(entry.tags || []);
  const pendingTags = text.trim() ? [...tags, text] : tags;
  const dirty = JSON.stringify(pendingTags) !== JSON.stringify(baseline);
  useEffect(() => {
    alive.current = true; dialog.current.showModal();
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    const next = entry.tags || [];
    setTags((current) => JSON.stringify(current) === JSON.stringify(baseline) ? next : current);
    setBaseline(next);
    // Only native saved tags trigger a refresh; keep all typed edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);
  useCopilotContext(() => ({ editors: [{ kind: "entry-tags", object_id: entry.id, dirty,
    fields: { tags, new_tag: text }, changed: dirty ? { tags: pendingTags } : {} }] }));
  const edit = () => { version.current++; setMessage(null); };
  const add = () => { if (!text.trim()) return; edit(); setTags((current) => [...current, text]); setText(""); };
  const save = async () => {
    const submitted = pendingTags, ticket = version.current;
    setBusy(true); setMessage(null);
    try {
      const stored = await api.entries.update(entry.id, { tags: submitted });
      // Refresh the list even if closed after this committed write.
      onSaved(stored);
      if (!alive.current) return;
      setBaseline(stored.tags);
      if (ticket === version.current) { setTags(stored.tags); setText(""); }
      setMessage({ text: ticket === version.current ? "Etiquetas guardadas." : "Etiquetas enviadas guardadas. Quedan cambios posteriores sin guardar." });
    } catch (error) {
      if (alive.current) setMessage({ error: true, text: error.message });
    } finally { if (alive.current) setBusy(false); }
  };
  return <dialog ref={dialog} className="m-auto max-h-[calc(100dvh-32px)] overflow-y-auto" onClose={onClose} aria-labelledby="entry-tags-title">
    <h2 id="entry-tags-title" className="text-[19px] font-semibold">Etiquetas del movimiento</h2>
    <p className="mt-1 break-words text-[13px]">{entry.counterparty || "Sin concepto"} · {formatCents(entry.amount_cents, currency)}</p>
    <p className="help mt-2">Cada etiqueta es un texto completo: las comas, espacios y # forman parte de ella. Guardar sólo cambia las etiquetas de este movimiento.</p>
    <ul className="my-4 space-y-2" aria-label="Etiquetas en edición">
      {tags.map((tag, index) => <li key={index} className="flex items-start justify-between gap-3 text-[13px]">
        <span className="min-w-0 break-words">{tag}</span>
        <button type="button" className="btn btn-sm shrink-0" aria-label={`Quitar etiqueta ${index + 1}: ${tag}`} onClick={() => { edit(); setTags((current) => current.filter((_, i) => i !== index)); }}>Quitar</button>
      </li>)}
    </ul>
    {!tags.length && <p className="help my-4">Sin etiquetas en la lista.</p>}
    <Field label="Nueva etiqueta" help="Hasta 20 etiquetas de 40 caracteres. Guardar incluye también este campo si tiene texto.">
      <input className="field min-w-0" value={text} maxLength={40} autoFocus onChange={(event) => { edit(); setText(event.target.value); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} />
    </Field>
    <button type="button" className="btn mt-2" onClick={add} disabled={!text.trim()}>Añadir etiqueta a la lista</button>
    {message && <p className={`mt-3 text-[13px] ${message.error ? "expense" : "help"}`} role={message.error ? "alert" : "status"}>{message.text}</p>}
    <div className="mt-5 flex flex-wrap justify-end gap-2">
      <button type="button" className="btn" onClick={onClose}>Cerrar</button>
      <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !dirty}>{busy ? "Guardando…" : message?.error ? "Reintentar guardado" : "Guardar etiquetas"}</button>
    </div>
  </dialog>;
}
