import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { Page, Section, Empty, Field, useAction } from "../components/ui.jsx";
import { formatCents, dateLabel } from "../format.js";

function SettleForm({ row, symbol, run, busy, onDone }) {
  const [amount, setAmount] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    const out = await run(() => api.splits.settle({ person: row.person_ref || row.person, amount: amount.trim() }), "Pago apuntado.");
    if (out) { setAmount(""); onDone(); }
  };
  return (
    <form onSubmit={submit} className="mt-2 flex flex-wrap items-end gap-2">
      <Field label={`Ha devuelto (debe ${formatCents(row.balance_cents, symbol)})`}>
        <input className="field field-sm num" inputMode="decimal" placeholder={String(row.balance_cents / 100).replace(".", ",")} value={amount} onChange={(e) => setAmount(e.target.value)} required />
      </Field>
      <button type="button" className="btn btn-sm" onClick={() => setAmount(String(row.balance_cents / 100).replace(".", ","))}>Todo</button>
      <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !amount.trim()}>Apuntar pago</button>
    </form>
  );
}

export default function Compartidos() {
  const { settings, notify } = useApp();
  const symbol = settings?.currency_symbol || "€";
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);
  const [run, busy] = useAction(notify);

  const load = useCallback(async () => {
    try { setData(await api.splits.balance()); } catch (e) { notify({ kind: "error", text: e.message }); }
  }, [notify]);
  useEffect(() => { load(); }, [load]);

  const rows = data?.balances || [];
  const label = (r) => (r.direction === "owes_me" ? "te debe" : r.direction === "i_owe" ? "le debes" : "al día");

  return (
    <Page
      title="Compartidos"
      description="Gastos que pagaste tú y repartiste con otras personas. Reparte un gasto desde Movimientos con el botón Repartir; aquí ves quién te debe y apuntas lo que te devuelven."
      actions={data && data.owed_to_me_cents > 0 && <span className="chip chip-income num">Te deben {formatCents(data.owed_to_me_cents, symbol)}</span>}
    >
      {!data ? <p className="help">Cargando…</p> : !rows.length ? (
        <Empty text="Todavía no has repartido ningún gasto." action={<a href="#/movimientos" className="btn btn-primary">Ir a Movimientos</a>} />
      ) : (
        <div className="space-y-4">
          {rows.map((r) => (
            <Section
              key={r.person_ref || r.person}
              title={r.person}
              aside={<span className={`num font-semibold ${r.direction === "owes_me" ? "income" : r.direction === "i_owe" ? "expense" : ""}`}>{label(r)} {r.direction === "settled" ? "" : formatCents(Math.abs(r.balance_cents), symbol)}</span>}
            >
              <p className="help text-[12px]">
                Repartido {formatCents(r.owed_cents, symbol)} · devuelto {formatCents(r.paid_cents, symbol)}
                {r.oldest_open_date ? ` · pendiente desde ${dateLabel(r.oldest_open_date)}` : ""}
                {r.person_ref ? " · en la libreta de contactos" : ""}
              </p>
              <ul className="mt-2 divide-y text-[13px]" style={{ borderColor: "var(--line)" }}>
                {r.expenses.map((x) => (
                  <li key={`${x.tx_id}`} className="flex items-center justify-between gap-2 py-1.5">
                    <a href={`#/movimientos?tx=${x.tx_id}`} className="btn-link">{dateLabel(x.date)} · {x.merchant || "Sin concepto"}</a>
                    <span className="num">{formatCents(x.share_cents, symbol)}</span>
                  </li>
                ))}
              </ul>
              {r.balance_cents > 0 && (
                open === (r.person_ref || r.person)
                  ? <SettleForm row={r} symbol={symbol} run={run} busy={busy} onDone={() => { setOpen(null); load(); }} />
                  : <button type="button" className="btn btn-sm mt-2" onClick={() => setOpen(r.person_ref || r.person)}>Apuntar devolución</button>
              )}
            </Section>
          ))}
        </div>
      )}
    </Page>
  );
}
