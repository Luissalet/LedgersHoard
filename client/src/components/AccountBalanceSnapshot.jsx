import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { Field } from "./ui.jsx";
import { dateLabel, formatCents, today } from "../format.js";
import { useCopilotContext } from "../copilot-hooks.js";

export default function AccountBalanceSnapshot() {
  const { accounts, settings } = useApp();
  const [at, setAt] = useState(() => sessionStorage.getItem("ledger.balance.at") ?? today());
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  const applied = useRef(null);
  const load = async (date) => {
    const version = ++request.current;
    applied.current = date;
    setLoading(true); setError(null); setResult(null);
    try {
      const data = await api.accounts.balances(date);
      if (version === request.current) setResult(data);
    } catch (e) {
      if (version === request.current) setError(e.message);
    } finally {
      if (version === request.current) setLoading(false);
    }
  };
  useEffect(() => {
    if (applied.current === at) void load(at);
    // Refresh recorded data without replacing the selected date.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts]);
  useEffect(() => () => { request.current++; }, []);
  useCopilotContext(() => ({ view: { balance_at: at, balances_applied_at: result?.at || null } }));
  const changeDate = (event) => {
    request.current++; applied.current = null;
    sessionStorage.setItem("ledger.balance.at", event.target.value);
    setAt(event.target.value); setResult(null); setError(null); setLoading(false);
  };
  return (
    <details className="panel mb-4">
      <summary className="cursor-pointer font-semibold">Consultar saldo a una fecha</summary>
      <div className="mt-3 space-y-3">
        <p className="help text-[13px]">Saldo inicial guardado más movimientos hasta la fecha de corte, incluida. Se usan las cuentas y su estado actuales; cada moneda se muestra por separado.</p>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); void load(at); }}>
          <Field label="Fecha de corte"><input className="field" type="date" value={at} onChange={changeDate} required /></Field>
          <button type="submit" className="btn btn-primary" disabled={loading || !at}>{loading ? "Consultando…" : "Consultar saldos"}</button>
        </form>
        {error && <p role="alert" className="text-[13px]" style={{ color: "var(--danger-ink)" }}>{error}</p>}
        {loading && <p role="status" className="help">Consultando saldos registrados…</p>}
        {result && <div className="space-y-2">
          <h2 className="text-[17px] font-semibold">Saldos registrados al {dateLabel(result.at)}</h2>
          {!result.accounts.length ? <p className="help">No hay cuentas registradas.</p> : <div className="overflow-x-auto" role="region" aria-label="Saldos por cuenta a la fecha aplicada" tabIndex={0}>
            <table className="table"><thead><tr><th scope="col">Cuenta</th><th scope="col">Moneda</th><th scope="col">Estado actual</th><th scope="col" className="r">Saldo</th></tr></thead><tbody>
              {result.accounts.map((account) => <tr key={account.id}><th scope="row">{account.name}</th><td>{account.currency}</td><td>{account.archived ? "Archivada" : "Activa"}</td><td className="r num">{formatCents(account.balance, account.currency === "EUR" ? settings?.currency_symbol || "€" : account.currency)}</td></tr>)}
            </tbody></table>
          </div>}
        </div>}
      </div>
    </details>
  );
}
