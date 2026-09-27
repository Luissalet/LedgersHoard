import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { Page, Section, MonthPicker } from "../components/ui.jsx";
import { MonthsChart, CategoryDonut } from "../components/charts.jsx";
import { formatCents, monthLabel, monthShort, thisMonth, addMonths } from "../format.js";

export default function Informes() {
  const { settings, notify } = useApp();
  const symbol = settings?.currency_symbol || "€";
  const [month, setMonth] = useState(thisMonth());
  const [months, setMonths] = useState([]);
  const [summary, setSummary] = useState(null);
  const [recurring, setRecurring] = useState([]);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([api.months(addMonths(month, -11), month), api.summary(month), api.recurring(month)])
      .then(([m, s, r]) => { if (alive) { setMonths(m.months); setSummary(s); setRecurring(r.candidates); } })
      .catch((e) => notify({ kind: "error", text: e.message }));
    return () => { alive = false; };
  }, [month, notify]);

  const totalIncome = months.reduce((s, m) => s + m.income, 0);
  const totalExpense = months.reduce((s, m) => s + m.expense, 0);
  const withData = months.filter((m) => m.income || m.expense).length || 1;

  return (
    <Page title="Informes" description="Doce meses de ingresos frente a gastos y el reparto por categoría del mes elegido." actions={<MonthPicker value={month} onChange={setMonth} />}>
      <Section title={`Últimos 12 meses hasta ${monthLabel(month)}`} aside={<button type="button" className="btn-link text-[13px]" onClick={() => setShowTable((v) => !v)}>{showTable ? "Ver gráfico" : "Ver tabla"}</button>}>
        {showTable ? (
          <table className="table">
            <thead><tr><th>Mes</th><th className="r">Ingresos</th><th className="r">Gastos</th><th className="r">Neto</th></tr></thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month}><td>{monthShort(m.month)}</td><td className="r num income">{formatCents(m.income, symbol)}</td><td className="r num expense">{formatCents(m.expense, symbol)}</td><td className={`r num ${m.net < 0 ? "expense" : ""}`}>{formatCents(m.net, symbol)}</td></tr>
              ))}
            </tbody>
          </table>
        ) : (
          <MonthsChart months={months} symbol={symbol} />
        )}
        <p className="help num mt-3">Media mensual: ingresos {formatCents(Math.round(totalIncome / withData), symbol)} · gastos {formatCents(Math.round(totalExpense / withData), symbol)} · ahorro {formatCents(totalIncome - totalExpense, symbol)} en el periodo.</p>
      </Section>
      <Section title={`Gasto por categoría · ${monthLabel(month)}`} className="mt-4">
        {summary && <CategoryDonut lines={summary.categories.filter((l) => l.kind === "expense" || !l.id)} symbol={symbol} />}
      </Section>
      <Section title="Pagos que parecen periódicos" className="mt-4">
        <p className="help mb-3">Detectados en los últimos 18 meses a partir de movimientos registrados. Un cambio de importe no confirma una subida de tarifa.</p>
        {recurring.length ? <table className="table">
          <thead><tr><th>Concepto</th><th>Frecuencia</th><th className="r">Importe habitual</th><th className="r">Último cobro</th><th>Lectura</th></tr></thead>
          <tbody>{recurring.map((item) => <tr key={`${item.account}-${item.counterparty}`}>
            <td><strong>{item.counterparty}</strong><div className="help">{item.account} · {item.occurrences} cobros</div>
              <details><summary className="btn-link text-[13px]">Ver movimientos</summary><div className="help">{item.evidence.map((entry) => `${entry.date}: ${formatCents(entry.amount_cents, item.currency === "EUR" ? symbol : item.currency)}`).join(" · ")}</div></details>
            </td>
            <td>{item.frequency === "monthly" ? "Mensual" : "Trimestral"}</td>
            <td className="r num">{formatCents(item.typical_amount_cents, item.currency === "EUR" ? symbol : item.currency)}</td>
            <td className="r num">{formatCents(item.latest_amount_cents, item.currency === "EUR" ? symbol : item.currency)}<div className="help">{item.last_date}</div></td>
            <td>{item.variable ? "Importe variable" : item.price_change ? `Cambió ${formatCents(item.change_cents, item.currency === "EUR" ? symbol : item.currency)}` : "Importe estable"}</td>
          </tr>)}</tbody>
        </table> : <p className="help">Aún no hay suficientes cobros periódicos para mostrar candidatos.</p>}
      </Section>
    </Page>
  );
}
