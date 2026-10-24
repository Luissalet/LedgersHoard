import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { formatCents, monthLabel } from "../format.js";
import { useCopilotContext } from "../copilot-hooks.js";
import { Section } from "./ui.jsx";

const ANOMALY_LABELS = { duplicate:"Posible cobro doble", amount_spike:"Importe muy alto", extra_charge:"Cobro de más este mes", new_merchant_large:"Primer cobro grande" };
const entryLink = id => `#/movimientos?tx=${encodeURIComponent(id)}`;
const money = (cents, currency, symbol) => formatCents(cents, currency === "EUR" ? symbol : currency);

export function EvidenceLinks({ item, symbol }) {
  return <details>
    <summary className="btn-link text-[13px]">Ver movimientos ({item.evidence.length})</summary>
    <ul className="mt-2 space-y-2 text-[13px]">
      {item.evidence.map((entry,index) => <li key={`${entry.id}-${index}`}>
        <a className="btn-link inline-block py-1" href={entryLink(entry.id)} aria-label={`Abrir movimiento ${entry.date}, ${money(entry.amount_cents,item.currency,symbol)}, ${item.account}, ${item.counterparty}, evidencia ${index+1}`}>
          {entry.date}: {money(entry.amount_cents,item.currency,symbol)} · Abrir movimiento
        </a>
      </li>)}
    </ul>
  </details>;
}

export function AnomalyRows({ items, symbol }) {
  return items.map(item => <tr key={`${item.kind}-${item.entry_id}`}>
    <td className="num">{item.date}</td>
    <td><strong>{item.counterparty}</strong><div className="help">{item.account}</div></td>
    <td className="r num expense">{money(item.amount_cents,item.currency,symbol)}</td>
    <td><span className={`chip ${item.severity === "high" ? "chip-danger" : item.severity === "medium" ? "chip-warn" : ""}`}>{ANOMALY_LABELS[item.kind]}</span><div className="help">{item.reason}</div>
      <a className="btn-link my-2 inline-block text-[13px]" href={entryLink(item.entry_id)} aria-label={`Abrir cobro señalado de ${item.counterparty}, ${item.date}, ${item.account}`}>Abrir cobro señalado</a>
      <EvidenceLinks item={item} symbol={symbol} />
    </td>
  </tr>);
}

export default function ReportEvidence({ month, tick, symbol }) {
  const [retry,setRetry]=useState(0), [stored,setStored]=useState(null);
  const key=JSON.stringify([month,tick,retry]);
  const result=stored?.key===key?stored:null;
  const loading=!result||result.loading, error=result?.error;
  const anomalies=result?.anomalies, recurring=result?.recurring;
  useCopilotContext(()=>({view:{report_evidence:{requested_month:month,applied_month:anomalies?.to||null,state:loading?"loading":error?"error":"ready"}}}));
  useEffect(()=>{
    let alive=true;
    setStored({key,loading:true});
    Promise.all([api.anomalies(month),api.recurring(month)]).then(([anomalies,recurring])=>{
      if(alive)setStored({key,loading:false,anomalies,recurring});
    }).catch(failure=>{if(alive)setStored({key,loading:false,error:failure.message});});
    return ()=>{alive=false;};
  },[month,tick,retry,key]);
  return <div className="mt-4" aria-busy={loading}>
    <p className="help mb-3">{loading?`Consultando evidencia hasta ${monthLabel(month)}…`:error?`No se pudo consultar la evidencia hasta ${monthLabel(month)}.`:`Evidencia consultada hasta ${monthLabel(anomalies.to)}.`}</p>
    {!loading&&!error&&<p className="help mb-3 sm:hidden">Desliza las tablas para ver sus columnas y enlaces.</p>}
    {error&&<div className="mb-4" role="alert"><p>{error}</p><button type="button" className="btn mt-2" onClick={()=>setRetry(value=>value+1)}>Reintentar evidencia</button></div>}
    <Section title="Cargos fuera de lo normal">
      <p className="help mb-3">Cobros desde el {anomalies?.recent_from||"…"} que se salen de lo habitual en su comercio: el mismo importe repetido en pocos días, una subida fuerte, un cobro de más en un mes o un primer cobro grande. Son avisos para revisar, no pruebas de un error.</p>
      {loading?<p className="help" role="status">Cargando cargos…</p>:error?<p className="help">No hay evidencia disponible para este periodo. Reintenta la consulta.</p>:anomalies.anomalies.length?<div className="overflow-x-auto"><table className="table min-w-[640px]" data-testid="anomalies">
        <thead><tr><th>Fecha</th><th>Comercio</th><th className="r">Importe</th><th>Aviso y movimientos</th></tr></thead>
        <tbody><AnomalyRows items={anomalies.anomalies} symbol={symbol} /></tbody>
      </table></div>:<p className="help">Nada fuera de lo normal en este periodo.</p>}
    </Section>
    <Section title="Pagos que parecen periódicos" className="mt-4">
      <p className="help mb-3">Detectados en los últimos 18 meses a partir de movimientos registrados{recurring?`, desde ${recurring.from} hasta ${recurring.to}`:""}. Un cambio de importe no confirma una subida de tarifa ni una suscripción activa.</p>
      {loading?<p className="help" role="status">Cargando candidatos…</p>:error?<p className="help">No hay evidencia disponible para este periodo. Reintenta la consulta.</p>:recurring.candidates.length?<div className="overflow-x-auto"><table className="table min-w-[640px]">
        <thead><tr><th>Concepto y movimientos</th><th>Frecuencia</th><th className="r">Importe habitual</th><th className="r">Último cobro</th><th>Lectura</th></tr></thead>
        <tbody>{recurring.candidates.map((item,index)=><tr key={`${item.account}-${item.counterparty}-${index}`}>
          <td><strong>{item.counterparty}</strong><div className="help">{item.account} · {item.occurrences} cobros</div><EvidenceLinks item={item} symbol={symbol} /></td>
          <td>{item.frequency==="monthly"?"Mensual":"Trimestral"}</td>
          <td className="r num">{money(item.typical_amount_cents,item.currency,symbol)}</td>
          <td className="r num">{money(item.latest_amount_cents,item.currency,symbol)}<div className="help">{item.last_date}</div></td>
          <td>{item.variable?"Importe variable":item.price_change?`Cambió ${money(item.change_cents,item.currency,symbol)}`:"Importe estable"}</td>
        </tr>)}</tbody>
      </table></div>:<p className="help">Aún no hay suficientes cobros periódicos para mostrar candidatos.</p>}
    </Section>
  </div>;
}
