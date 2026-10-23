import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { formatCents, monthLabel, monthEnd } from "../format.js";
import { useCopilotContext } from "../copilot-hooks.js";

export default function AnnualReport({ tick, symbol }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [draft, setDraft] = useState(String(year));
  const [currency, setCurrency] = useState("");
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useCopilotContext(() => ({ view: { annual_report_year: year, annual_report_currency: currency || report?.currency || null }, editors: draft !== String(year) ? [{ kind: "annual-report", object_id: "new", dirty: true, fields: { year: draft } }] : [] }));

  useEffect(() => {
    let alive = true;
    setReport(null);
    setError("");
    api.year(year).then((result) => {
      if (!alive) return;
      setReport(result);
      setCurrency((previous) => result.currencies.some((item) => item.currency === previous) ? previous : result.currency);
    }).catch((failure) => { if (alive) setError(failure.message); });
    return () => { alive = false; };
  }, [year, tick, retry]);

  const currencies = report?.currencies.length ? report.currencies : report ? [report] : [];
  const selected = currencies.find((item) => item.currency === currency) || currencies[0];
  const money = (cents) => formatCents(cents, selected?.currency === "EUR" ? symbol : selected?.currency);
  const link = (month) => `#/movimientos?from=${month}-01&to=${monthEnd(month)}`;
  const applyYear = (event) => { event.preventDefault(); setYear(Number(draft)); };

  return <section className="panel-white mb-4 annual-report" aria-labelledby="annual-report-title">
    <header className="annual-report-header">
      <div><h2 id="annual-report-title" className="text-[17px] font-semibold">Informe anual</h2><p className="help">Movimientos registrados de enero a diciembre. Cada moneda se consulta por separado.</p></div>
      <form onSubmit={applyYear} className="annual-report-controls">
        <label className="label">Año<input className="field field-sm num" type="number" min="1970" max="2200" step="1" required value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
        <button className="btn" type="submit">Mostrar año</button>
      </form>
    </header>
    {error ? <div role="alert" className="mt-3"><p>{error}</p><button className="btn mt-2" onClick={() => setRetry((value) => value + 1)}>Reintentar informe anual</button></div> : !report ? <p role="status" className="help mt-3">Cargando informe de {year}…</p> : <>
      <div className="annual-report-currencies" role="group" aria-label="Moneda del informe anual">{currencies.map((item) => <button key={item.currency} type="button" className="btn btn-sm" aria-pressed={selected.currency === item.currency} onClick={() => setCurrency(item.currency)}>{item.currency}</button>)}</div>
      <p className="help mb-3">{year} · {selected.movements} movimientos · {selected.currency}. Los traspasos no cuentan como ingresos ni gastos.</p>
      {!selected.movements ? <p className="help">No hay movimientos registrados en {year}.</p> : <div className="annual-report-tables">
        <div className="overflow-x-auto">
          <table className="table annual-report-months"><caption className="text-left font-semibold mb-2">Por mes · {selected.currency}</caption>
            <thead><tr><th>Mes</th><th className="r">Ingresos</th><th className="r">Gastos</th><th className="r">Neto</th></tr></thead>
            <tbody>{selected.by_month.map((row) => <tr key={row.month}><th scope="row"><a className="btn-link" href={link(row.month)} aria-label={`Ver movimientos de ${monthLabel(row.month)}, todas las cuentas`}>{monthLabel(row.month).replace(` ${year}`, "")}</a></th><td className="r num income">{money(row.income_cents)}</td><td className="r num expense">{money(row.expense_cents)}</td><td className={`r num ${row.net_cents < 0 ? "expense" : ""}`}>{money(row.net_cents)}</td></tr>)}</tbody>
            <tfoot><tr><th scope="row">Total {year}</th><td className="r num income">{money(selected.income_cents)}</td><td className="r num expense">{money(selected.expense_cents)}</td><td className={`r num ${selected.net_cents < 0 ? "expense" : ""}`}>{money(selected.net_cents)}</td></tr></tfoot>
          </table>
        </div>
        <div className="overflow-x-auto">
          <table className="table annual-report-categories"><caption className="text-left font-semibold mb-2">Por categoría · {selected.currency}</caption><thead><tr><th>Categoría</th><th className="r">Ingresos</th><th className="r">Gastos</th></tr></thead><tbody>{selected.by_category.map((row) => <tr key={row.category_id || "uncategorized"}><th scope="row">{row.category}</th><td className="r num income">{money(row.earned_cents)}</td><td className="r num expense">{money(row.spent_cents)}</td></tr>)}</tbody></table>
        </div>
      </div>}
      <p className="help mt-3">Importes en {selected.currency}, sin conversión. Los enlaces de mes abren los movimientos de todas las cuentas y monedas; aplica allí los filtros que necesites.</p>
    </>}
  </section>;
}
