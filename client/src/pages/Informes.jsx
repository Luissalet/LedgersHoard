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
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([api.months(addMonths(month, -11), month), api.summary(month)])
      .then(([m, s]) => { if (alive) { setMonths(m.months); setSummary(s); } })
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
    </Page>
  );
}
