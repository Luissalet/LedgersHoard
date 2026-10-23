import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { Page, Section, Field } from "../components/ui.jsx";
import { formatCents, thisMonth, addMonths, monthLabel } from "../format.js";
import { changedFields } from "../copilot-context.js";
import { useCopilotContext, useCopilotRefresh } from "../copilot-hooks.js";
import ForecastComparison from "../components/ForecastComparison.jsx";

export default function Prevision() {
  const { accounts, settings, notify } = useApp();
  const symbol = settings?.currency_symbol || "€";
  const [scenarios, setScenarios] = useState([]);
  const [selected, setSelected] = useState("");
  const [scenario, setScenario] = useState(null);
  const [projection, setProjection] = useState(null);
  const [comparisonId, setComparisonId] = useState("off");
  const [comparison, setComparison] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [name, setName] = useState("");
  const [from, setFrom] = useState(addMonths(thisMonth(), 1));
  const [months, setMonths] = useState(6);
  const [line, setLine] = useState({ account_id: "", label: "", amount: "", start_month: addMonths(thisMonth(), 1), end_month: "", cadence: "once" });
  const [editingId, setEditingId] = useState(null);
  const [lineBase, setLineBase] = useState(null);   // the supuesto as it was when editing began: only changed fields are saved
  const load = useCallback(async () => {
    const [all, details, forecast] = await Promise.all([
      api.scenarios.list(), selected ? api.scenarios.get(selected) : Promise.resolve(null), api.forecast(selected || undefined, from, Number(months)),
    ]);
    setScenarios(all); setScenario(details); setProjection(forecast);
  }, [selected, from, months]);
  useEffect(() => { load().catch((e) => notify({ kind: "error", text: e.message })); }, [load, notify]);
  useEffect(() => {
    let current = true;
    setComparison(null);
    if (comparisonId !== "off") api.compareForecasts(selected || undefined, comparisonId || undefined, from, Number(months))
      .then((result) => { if (current) setComparison(result); })
      .catch((error) => { if (current) notify({ kind: "error", text: error.message }); });
    return () => { current = false; };
  }, [selected, comparisonId, from, months, scenario, notify]);
  useCopilotRefresh(() => { load().catch(() => {}); });
  useCopilotContext(() => {
    const blankLine = !line.label && !line.amount;
    const editing = !!editingId;
    return {
      view: { scenario: selected, comparison_scenario: comparisonId === "off" ? null : comparisonId, from, months },
      editors: [
        ...(scenario && (editing || !blankLine) ? [{ kind: "scenario-line-form", object_id: editingId, scenario_id: selected, dirty: true, fields: line }] : []),
        ...(name.trim() ? [{ kind: "scenario-new", object_id: null, dirty: true, fields: { name } }] : []),
      ],
    };
  });
  useEffect(() => { api.recurring(thisMonth()).then((r) => setCandidates(r.candidates)).catch(() => {}); }, []);
  const act = async (fn, success) => {
    try { const out = await fn(); await load(); if (success) notify({ kind: "ok", text: success }); return out; }
    catch (e) { notify({ kind: "error", text: e.message }); return null; }
  };
  const create = async (e) => {
    e.preventDefault();
    const out = await act(() => api.scenarios.create({ name }), "Escenario creado.");
    if (out) { setName(""); setSelected(out.id); }
  };
  const addLine = async (e) => {
    e.preventDefault();
    if (!selected) return;
    const payload = { ...line, account_id: line.account_id || accounts?.[0]?.id,
      end_month: line.cadence !== "once" && line.end_month ? line.end_month : null };
    const original = lineBase && { account_id: lineBase.account_id, label: lineBase.label, amount: (lineBase.amount_cents / 100).toFixed(2), start_month: lineBase.start_month, end_month: lineBase.end_month || null, cadence: lineBase.cadence };
    const patch = editingId && original ? changedFields(original, payload) : payload;
    const out = await act(() => editingId ? api.scenarios.updateLine(selected, editingId, patch) : api.scenarios.addLine(selected, payload), editingId ? "Supuesto actualizado." : "Supuesto añadido.");
    if (out) { setLine({ ...line, label: "", amount: "" }); setEditingId(null); setLineBase(null); }
  };
  return <Page title="Previsión" description="Compara el saldo registrado con un escenario de ingresos y gastos futuros. Los supuestos no crean movimientos reales.">
    <Section title="Escenarios">
      <div className="flex flex-wrap gap-3 items-end">
        <Field label="Escenario"><select className="field" value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">Solo saldo registrado</option>{scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></Field>
        <Field label="Comparar con (B)"><select className="field" value={comparisonId} onChange={(e) => setComparisonId(e.target.value)}>
          <option value="off">Sin comparar</option><option value="">Solo saldo registrado</option>{scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></Field>
        <form onSubmit={create} className="flex gap-2 items-end"><Field label="Nuevo escenario"><input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Mudanza" required /></Field><button className="btn" type="submit">Crear</button></form>
        {scenario && <button className="btn" type="button" onClick={async () => { if (!window.confirm(`¿Eliminar el escenario ${scenario.name}?`)) return; try { await api.scenarios.remove(scenario.id); if (comparisonId === scenario.id) setComparisonId("off"); setSelected(""); setEditingId(null); notify({ kind: "ok", text: "Escenario eliminado." }); } catch (e) { notify({ kind: "error", text: e.message }); } }}>Eliminar escenario</button>}
      </div>
      <div className="flex flex-wrap items-end gap-3 mt-4">
        <Field label="Mes inicial"><input className="field" aria-label="Mes inicial" type="month" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Horizonte"><select className="field" aria-label="Horizonte" value={months} onChange={(e) => setMonths(Number(e.target.value))}>{[3, 6, 12, 24].map((n) => <option key={n} value={n}>{n} meses</option>)}</select></Field>
        <p className="help pb-2">El mismo periodo se aplica a las dos alternativas.</p>
      </div>
    </Section>
    {comparison && <ForecastComparison comparison={comparison} accounts={accounts || []} symbol={symbol} />}
    {scenario && <Section title={`Supuestos · ${scenario.name}`} className="mt-4">
      <form onSubmit={addLine} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 items-end">
        <Field label="Concepto"><input className="field" required value={line.label} onChange={(e) => setLine({ ...line, label: e.target.value })} placeholder="Alquiler" /></Field>
        <Field label="Cuenta"><select className="field" required value={line.account_id || accounts?.[0]?.id || ""} onChange={(e) => setLine({ ...line, account_id: e.target.value })}>{(accounts || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <Field label="Importe (+ ingreso, − gasto)"><input className="field" required value={line.amount} onChange={(e) => setLine({ ...line, amount: e.target.value })} placeholder="-650,00" /></Field>
        <Field label="Desde"><input className="field" type="month" required value={line.start_month} onChange={(e) => setLine({ ...line, start_month: e.target.value })} /></Field>
        <Field label="Frecuencia"><select className="field" value={line.cadence} onChange={(e) => setLine({ ...line, cadence: e.target.value })}><option value="once">Una vez</option><option value="monthly">Cada mes</option><option value="quarterly">Cada 3 meses</option></select></Field>
        <button className="btn" type="submit">{editingId ? "Guardar" : "Añadir"}</button>
        {editingId && <button className="btn" type="button" onClick={() => { setEditingId(null); setLine({ ...line, label: "", amount: "" }); }}>Cancelar edición</button>}
        {line.cadence !== "once" && <Field label="Hasta (opcional)"><input className="field" type="month" value={line.end_month} onChange={(e) => setLine({ ...line, end_month: e.target.value })} /></Field>}
      </form>
      {candidates.length > 0 && <div className="mt-4"><p className="help mb-2">Pagos detectados en el historial. Puedes cargar uno en el formulario y decidir si sigue vigente antes de añadirlo.</p><div className="flex flex-wrap gap-2">{candidates.slice(0, 8).map((c) => <button className="btn btn-sm" type="button" key={`${c.account}-${c.counterparty}`} onClick={() => {
        const account = accounts?.find((a) => a.name === c.account);
        const step = c.frequency === "quarterly" ? 3 : 1;
        let next = addMonths(c.last_date.slice(0, 7), step);
        while (next < addMonths(thisMonth(), 1)) next = addMonths(next, step);
        setEditingId(null);
        setLine({ account_id: account?.id || "", label: c.counterparty, amount: (-c.latest_amount_cents / 100).toFixed(2), start_month: next, end_month: "", cadence: c.frequency });
      }}>{c.counterparty} · {formatCents(c.latest_amount_cents, c.currency === "EUR" ? symbol : c.currency)}</button>)}</div></div>}
      {scenario.lines.length ? <div className="overflow-x-auto mt-4"><table className="table"><thead><tr><th>Concepto</th><th>Cuenta</th><th>Desde</th><th>Frecuencia</th><th className="r">Importe</th><th></th></tr></thead><tbody>
        {scenario.lines.map((item) => <tr key={item.id}><td>{item.label}</td><td>{accounts?.find((a) => a.id === item.account_id)?.name || item.account_id}</td><td>{item.start_month}{item.end_month ? ` → ${item.end_month}` : ""}</td><td>{item.cadence === "monthly" ? "Mensual" : item.cadence === "quarterly" ? "Trimestral" : "Puntual"}</td><td className="r num">{formatCents(item.amount_cents, accounts?.find((a) => a.id === item.account_id)?.currency === "EUR" ? symbol : accounts?.find((a) => a.id === item.account_id)?.currency || symbol)}</td><td><button className="btn-link mr-3" type="button" onClick={() => { setEditingId(item.id); setLineBase(item); setLine({ account_id: item.account_id, label: item.label, amount: (item.amount_cents / 100).toFixed(2), start_month: item.start_month, end_month: item.end_month || "", cadence: item.cadence }); }}>Editar</button><button className="btn-link" type="button" onClick={() => act(() => api.scenarios.removeLine(selected, item.id), "Supuesto eliminado.")}>Quitar</button></td></tr>)}
      </tbody></table></div> : <p className="help mt-3">Añade un gasto o ingreso para comparar el escenario con el saldo registrado.</p>}
    </Section>}
    <Section title="Saldos proyectados" className="mt-4">
      <p className="help mb-3">Los saldos registrados incluyen movimientos ya anotados. La diferencia procede solo de supuestos del escenario.</p>
      {projection && <div className="overflow-x-auto"><table className="table"><thead><tr><th>Mes</th><th className="r">Registrado</th><th className="r">Variación prevista</th><th className="r">Escenario</th></tr></thead><tbody>{projection.rows.map((row) => <tr key={row.month}><td>{monthLabel(row.month)}{row.lines.length > 0 && <details><summary className="btn-link">{row.lines.length} supuesto(s)</summary><span className="help">{row.lines.map((l) => `${l.label}: ${formatCents(l.amount_cents, row.accounts.find((a) => a.account_id === l.account_id)?.currency === "EUR" ? symbol : row.accounts.find((a) => a.account_id === l.account_id)?.currency || symbol)}`).join(" · ")}</span></details>}{row.accounts.length > 1 && <details><summary className="btn-link">Por cuenta</summary><span className="help">{row.accounts.map((a) => `${a.name}: ${formatCents(a.balance, a.currency === "EUR" ? symbol : a.currency)}`).join(" · ")}</span></details>}</td><td className="r num">{row.base_balance === null ? "Por cuenta" : formatCents(row.base_balance, row.currency === "EUR" ? symbol : row.currency)}</td><td className="r num">{row.change === null ? "Por cuenta" : formatCents(row.change, row.currency === "EUR" ? symbol : row.currency)}</td><td className="r num"><strong>{row.balance === null ? "Por cuenta" : formatCents(row.balance, row.currency === "EUR" ? symbol : row.currency)}</strong></td></tr>)}</tbody></table></div>}
    </Section>
  </Page>;
}
