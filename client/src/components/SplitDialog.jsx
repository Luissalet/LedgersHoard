import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { formatCents } from "../format.js";

const blank = () => ({ person: "", amount: "" });

/** Share one expense with other people: names (resolved against the address book by the server) and, optionally, each one's part. */
export default function SplitDialog({ entry, symbol, onClose, onDone, run, busy }) {
  const ref = useRef(null);
  const [rows, setRows] = useState([blank()]);
  const [existing, setExisting] = useState([]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (entry && !d.open) d.showModal();
    if (!entry && d.open) d.close();
    if (entry) {
      setRows([blank()]);
      api.entries.splits(entry.id).then((r) => setExisting(r.splits || [])).catch(() => setExisting([]));
    }
  }, [entry]);

  const set = (i, k) => (e) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)));
  const filled = rows.filter((r) => r.person.trim());
  const withAmount = filled.filter((r) => r.amount.trim());
  const mixed = withAmount.length > 0 && withAmount.length !== filled.length;

  const submit = async (e) => {
    e.preventDefault();
    if (!filled.length || mixed) return;
    const participants = filled.map((r) => (r.amount.trim() ? { person: r.person.trim(), amount: r.amount.trim() } : { person: r.person.trim() }));
    const out = await run(() => api.splits.add({ tx_id: entry.id, participants }), "Gasto repartido.");
    if (out) onDone(out);
  };
  const remove = async (person) => {
    const out = await run(() => api.entries.removeSplit(entry.id, person), "Reparto quitado.");
    if (out) { setExisting((xs) => xs.filter((x) => x.person !== person)); onDone(null); }
  };

  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="split-title">
      <h2 id="split-title" className="text-[19px] font-semibold">Repartir gasto</h2>
      {entry && <p className="mt-1 text-[13px]" style={{ color: "var(--muted)" }}>{entry.counterparty || "Sin concepto"} · {formatCents(entry.amount_cents, symbol)}</p>}
      {existing.length > 0 && (
        <ul className="mt-3 space-y-1 text-[13px]">
          {existing.map((x) => (
            <li key={x.person} className="flex items-center justify-between gap-2">
              <span>{x.person} <span className="help">· {x.share}</span></span>
              <button type="button" className="btn-link text-[12px]" onClick={() => remove(x.person)} disabled={busy}>Quitar</button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="mt-4 space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_110px] gap-2">
            <input className="field field-sm" placeholder="Persona" value={r.person} onChange={set(i, "person")} aria-label={`Persona ${i + 1}`} autoFocus={i === 0} />
            <input className="field field-sm num" inputMode="decimal" placeholder="Parte" value={r.amount} onChange={set(i, "amount")} aria-label={`Parte de la persona ${i + 1}`} />
          </div>
        ))}
        <button type="button" className="btn-link text-[13px]" onClick={() => setRows((rs) => [...rs, blank()])}>Añadir otra persona</button>
        <p className="help text-[12px]">{mixed ? "Indica la parte de todas las personas o de ninguna." : "Sin partes, el gasto se divide a partes iguales entre las personas y tú."}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cerrar</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !filled.length || mixed}>Repartir</button>
        </div>
      </form>
    </dialog>
  );
}
