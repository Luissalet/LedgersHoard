import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { dateLabel, formatCents, today } from "../format.js";
import { useCopilotContext, useCopilotRefresh } from "../copilot-hooks.js";
import { Field, Section } from "./ui.jsx";

export default function PaymentLookup({ accounts }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ amount: "", date: today(), merchant: "", currency: "" });
  const [result, setResult] = useState(null);
  const [request, setRequest] = useState(null);
  const generation = useRef(0);
  const key = JSON.stringify(form);
  const current = result?.key === key ? result : null;
  const busy = request?.key === key && request.loading;
  const error = request?.key === key ? request.error : "";
  const currencies = [...new Set(accounts.map((account) => account.currency))].sort();

  const invalidate = () => { generation.current++; setResult(null); setRequest(null); };
  const change = (field) => (event) => { invalidate(); setForm((previous) => ({ ...previous, [field]: event.target.value })); };
  const toggle = () => { invalidate(); setOpen((previous) => !previous); };
  useEffect(() => () => { generation.current++; }, []);
  useCopilotRefresh(invalidate);
  useCopilotContext(() => ({ view: open ? { payment_lookup: { ...form, days: 5, ...(current ? { count: current.data.count } : {}) } } : {} }));

  const search = async (event) => {
    event.preventDefault();
    const ticket = ++generation.current;
    setResult(null); setRequest({ key, loading: true });
    try {
      const data = await api.paymentLookup(form);
      if (ticket !== generation.current) return;
      setResult({ key, data }); setRequest(null);
    } catch (failure) {
      if (ticket === generation.current) setRequest({ key, loading: false, error: failure.message });
    }
  };

  return <div className="mb-4">
    <button type="button" className="btn" aria-expanded={open} aria-controls="payment-lookup" onClick={toggle}>{open ? "Cerrar búsqueda de pago" : "Buscar pago"}</button>
    {open && <div id="payment-lookup" className="mt-3">
      <Section title="Buscar el pago de un importe">
        <p className="help mb-3">Busca gastos del mismo importe entre cinco días antes y cinco después de la fecha. El comercio influye en la puntuación, pero no excluye otros comercios. Las coincidencias no confirman que una factura esté pagada.</p>
        <form onSubmit={search} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[140px_160px_1fr_160px_auto] lg:items-end">
          <Field label="Importe del pago"><input className="field num" inputMode="decimal" placeholder="54,99" value={form.amount} onChange={change("amount")} required /></Field>
          <Field label="Fecha de referencia"><input className="field" type="date" value={form.date} onChange={change("date")} required /></Field>
          <Field label="Comercio (opcional)"><input className="field" value={form.merchant} onChange={change("merchant")} maxLength={120} /></Field>
          <Field label="Moneda"><select className="field" value={form.currency} onChange={change("currency")}><option value="">Todas las monedas</option>{currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></Field>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Buscando…" : error ? "Reintentar búsqueda" : "Buscar coincidencias"}</button>
        </form>
        {error && <p className="expense mt-3 text-[13px]" role="alert">No se pudo buscar: {error}</p>}
        {current && <div className="mt-4" aria-live="polite">
          <p className="help mb-2">{current.data.count === 1 ? "1 coincidencia" : `${current.data.count} coincidencias`} · Orden nativo por puntuación. Puntuación sobre 1, no probabilidad. Sin conversión de monedas.</p>
          {current.data.matches.length ? <div className="overflow-x-auto"><table className="table">
            <thead><tr><th>Fecha</th><th>Comercio y cuenta</th><th className="r">Importe</th><th className="r">Puntuación</th><th></th></tr></thead>
            <tbody>{current.data.matches.map((match) => <tr key={match.tx_id}>
              <td className="num whitespace-nowrap">{dateLabel(match.date)}</td>
              <td><strong>{match.merchant || "Sin concepto"}</strong><div className="help">{match.account}</div></td>
              <td className="r num whitespace-nowrap">{formatCents(match.amount_cents, match.currency)}</td>
              <td className="r num">{match.score}</td>
              <td><a className="btn-link whitespace-nowrap" href={`#/movimientos?tx=${encodeURIComponent(match.tx_id)}`}>Abrir movimiento</a></td>
            </tr>)}</tbody>
          </table></div> : <p className="help">No hay coincidencias con este importe, fecha y moneda en la ventana indicada.</p>}
        </div>}
      </Section>
    </div>}
  </div>;
}
