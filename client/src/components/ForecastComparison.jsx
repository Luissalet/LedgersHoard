import React, { useState } from "react";
import { Section, Field } from "./ui.jsx";
import { formatCents, monthLabel } from "../format.js";

const cadenceLabel = { once: "Una vez", monthly: "Cada mes", quarterly: "Cada 3 meses" };

export default function ForecastComparison({ comparison, accounts, symbol }) {
  const [chosenCurrency, setChosenCurrency] = useState("");
  const currencies = comparison.rows[0]?.currencies.map((row) => row.currency) || [];
  const currency = currencies.includes(chosenCurrency) ? chosenCurrency : currencies[0];
  const money = (amount, unit = currency) => formatCents(amount, unit === "EUR" ? symbol : unit);
  const signed = (amount) => `${amount > 0 ? "+" : ""}${money(amount)}`;
  const leftName = comparison.left?.name || "Saldo registrado";
  const rightName = comparison.right?.name || "Saldo registrado";
  const final = comparison.rows.at(-1)?.currencies.find((row) => row.currency === currency);
  return <Section title="Comparación de escenarios" className="mt-4">
    <div className="forecast-comparison-heading">
      <div><p className="help">A · {leftName} / B · {rightName}</p>
        <p className="help mt-1">Diferencia = B − A. Un importe positivo deja más saldo en B.</p></div>
      {currencies.length > 1 && <Field label="Divisa"><select className="field" value={currency} onChange={(e) => setChosenCurrency(e.target.value)}>{currencies.map((unit) => <option key={unit}>{unit}</option>)}</select></Field>}
    </div>
    {final ? <>
      <p className="forecast-comparison-result">Al final de {monthLabel(comparison.rows.at(-1).month)}: <strong className={`num ${final.difference < 0 ? "expense" : ""}`}>{signed(final.difference)}</strong> en B respecto a A <span className="help">({currency})</span></p>
      <div className="overflow-x-auto"><table className="table forecast-comparison-table"><caption className="help text-left mb-2">Saldos al cierre del mes · {currency}. Despliega un mes para ver las cuentas.</caption><thead><tr><th>Mes</th><th className="r">A · {leftName}</th><th className="r">B · {rightName}</th><th className="r">Diferencia del mes</th><th className="r">Diferencia acumulada</th></tr></thead><tbody>
        {comparison.rows.map((row) => {
          const totals = row.currencies.find((item) => item.currency === currency);
          return <React.Fragment key={row.month}><tr><th scope="row">{monthLabel(row.month)}</th><td className="r num">{money(totals.left_balance)}</td><td className="r num">{money(totals.right_balance)}</td><td className="r num">{signed(totals.monthly_difference)}</td><td className="r num"><strong>{signed(totals.difference)}</strong></td></tr>
            <tr><td colSpan={5}><details><summary className="btn-link">Por cuenta · {monthLabel(row.month)}</summary><table className="table"><thead><tr><th>Cuenta</th><th className="r">A</th><th className="r">B</th><th className="r">Del mes</th><th className="r">Acumulada</th></tr></thead><tbody>{row.accounts.filter((account) => account.currency === currency).map((account) => <tr key={account.account_id}><th scope="row">{account.name}</th><td className="r num">{money(account.left_balance)}</td><td className="r num">{money(account.right_balance)}</td><td className="r num">{signed(account.monthly_difference)}</td><td className="r num">{signed(account.difference)}</td></tr>)}</tbody></table></details></td></tr>
          </React.Fragment>;
        })}
      </tbody></table></div>
    </> : <p className="help mt-3">Crea una cuenta para comparar saldos.</p>}
    <div className="forecast-assumptions">
      {[comparison.left, comparison.right].map((scenario, index) => <div key={index}>
        <h3 className="text-sm font-semibold">Supuestos {index === 0 ? "A" : "B"} · {scenario?.name || "Saldo registrado"}</h3>
        {scenario?.lines.length ? <ul>{scenario.lines.map((line) => {
          const account = accounts.find((item) => item.id === line.account_id);
          return <li key={line.id}><strong>{line.label}</strong> · <span className="num">{money(line.amount_cents, account?.currency || "EUR")}</span><br /><span className="help">{account?.name || line.account_id} · {cadenceLabel[line.cadence]} · {line.start_month}{line.end_month ? ` → ${line.end_month}` : ""}</span></li>;
        })}</ul> : <p className="help mt-2">Sin supuestos; solo movimientos registrados.</p>}
      </div>)}
    </div>
    <p className="help mt-3">{comparison.note} {comparison.difference_note}</p>
  </Section>;
}
