import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { Page, Section, MonthPicker, Empty } from "../components/ui.jsx";
import { formatCents, dateLabel, monthLabel, monthEnd, thisMonth, ACCOUNT_TYPES } from "../format.js";

function Tile({ label, value, tone }) {
  return (
    <div className="panel">
      <div className="label" style={{ color: "var(--supporting-ink)" }}>{label}</div>
      <div className={`num text-[22px] font-semibold ${tone || ""}`}>{value}</div>
    </div>
  );
}

export function BudgetBars({ lines, symbol }) {
  const expense = lines.filter((l) => l.kind === "expense" && (l.spent > 0 || l.budget));
  if (!expense.length) return <p className="help">Sin gastos este mes.</p>;
  return (
    <ul className="space-y-3">
      {expense.map((l) => {
        const pct = l.budget ? Math.min(100, Math.round((l.spent / l.budget) * 100)) : 0;
        return (
          <li key={l.id || "none"}>
            <div className="flex items-baseline justify-between gap-2 text-[13px]">
              <span className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: l.color || "var(--bar-bg)" }} aria-hidden="true" />
                {l.name}
                {l.over && <span className="chip chip-danger">Superado</span>}
              </span>
              <span className={`num ${l.over ? "expense" : ""}`}>
                {formatCents(l.spent, symbol)}
                {l.budget != null && <span className="help"> / {formatCents(l.budget, symbol)}</span>}
              </span>
            </div>
            {l.budget != null ? (
              <div className={`bar mt-1 ${l.over ? "over" : ""}`} role="meter" aria-valuemin="0" aria-valuemax={l.budget} aria-valuenow={l.spent} aria-label={`${l.name}: ${l.pct}% del presupuesto`}>
                <span style={{ width: `${pct}%` }} />
              </div>
            ) : (
              <div className="help mt-0.5 text-[11px]">Sin presupuesto</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function Resumen() {
  const { settings } = useApp();
  const symbol = settings?.currency_symbol || "€";
  const [month, setMonth] = useState(thisMonth());
  const [summary, setSummary] = useState(null);
  const [recent, setRecent] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    Promise.all([api.summary(month), api.entries.list({ from: `${month}-01`, to: monthEnd(month), limit: 8 })])
      .then(([s, r]) => { if (alive) { setSummary(s); setRecent(r.items); setError(null); } })
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [month]);

  const active = (summary?.accounts || []).filter((a) => !a.archived);
  const total = active.reduce((s, a) => s + a.balance, 0);

  return (
    <Page title="Resumen" description={`Ingresos, gastos y presupuestos de ${monthLabel(month)}.`} actions={<MonthPicker value={month} onChange={setMonth} />}>
      {error && <p className="expense mb-4" role="alert">{error}</p>}
      {summary && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Ingresos" value={formatCents(summary.income, symbol)} tone="income" />
            <Tile label="Gastos" value={formatCents(summary.expense, symbol)} tone="expense" />
            <Tile label="Neto del mes" value={formatCents(summary.net, symbol)} tone={summary.net < 0 ? "expense" : "income"} />
            <Tile label="Saldo total" value={formatCents(total, symbol)} />
          </div>
          <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
            <div className="space-y-4">
              <Section title="Presupuestos por categoría" aside={summary.budget.total > 0 && <span className="help num">{formatCents(summary.budget.spent, symbol)} de {formatCents(summary.budget.total, symbol)}</span>}>
                <BudgetBars lines={summary.categories} symbol={symbol} />
              </Section>
              <Section title="Últimos movimientos" aside={<a href="#/movimientos" className="btn-link text-[13px]">Ver todos</a>}>
                {recent.length ? (
                  <table className="table">
                    <thead><tr><th>Fecha</th><th>Concepto</th><th className="hidden sm:table-cell">Categoría</th><th className="r">Importe</th></tr></thead>
                    <tbody>
                      {recent.map((e) => (
                        <tr key={e.id}>
                          <td className="num whitespace-nowrap">{dateLabel(e.date)}</td>
                          <td>{e.counterparty || e.note || <span className="help">(sin concepto)</span>}<div className="help text-[11px] sm:hidden">{e.category_name || ""}</div></td>
                          <td className="hidden sm:table-cell">{e.category_name || <span className="help">—</span>}</td>
                          <td className={`r num whitespace-nowrap ${e.amount_cents < 0 ? "expense" : "income"}`}>{formatCents(e.amount_cents, symbol)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <Empty text="Todavía no hay movimientos este mes." action={<a href="#/movimientos" className="btn btn-primary">Apuntar el primero</a>} />
                )}
              </Section>
            </div>
            <Section title="Cuentas">
              {active.length ? (
                <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
                  {active.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 py-2 text-[13px]">
                      <span>{a.name} <span className="chip ml-1">{ACCOUNT_TYPES[a.type] || a.type}</span></span>
                      <span className={`num font-semibold ${a.balance < 0 ? "expense" : ""}`}>{formatCents(a.balance, a.currency === "EUR" ? symbol : a.currency)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty text="Aún no tienes cuentas." action={<a href="#/cuentas" className="btn btn-primary">Crear una cuenta</a>} />
              )}
            </Section>
          </div>
        </>
      )}
    </Page>
  );
}
