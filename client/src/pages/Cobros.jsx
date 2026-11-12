import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { Page, Section, Empty, Field, ConfirmDialog, useAction } from "../components/ui.jsx";
import { centsToText, dateLabel, today } from "../format.js";
import { useCopilotRefresh } from "../copilot-hooks.js";

const STATUS = { pending: "Pendiente", overdue: "Vencida", paid: "Cobrada", paused: "En pausa" };
const STATUS_CHIP = { pending: "chip", overdue: "chip chip-warn", paid: "chip chip-income", paused: "chip" };
const NOTICE_STATE = { draft: "Borrador", sent: "Enviado", discarded: "Descartado" };
const TONE = { sobrio: "Sobrio", cercano: "Cercano", formal: "Formal" };

const emptyForm = () => ({
  client: "", email: "", concept: "", amount: "", issued_date: today(), due_date: "", reference: "", payment_link: "", payment_terms: "", notes: "",
});

function NewForm({ onCreate, onCancel, busy }) {
  const [form, setForm] = useState(emptyForm);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <form className="panel grid gap-3 sm:grid-cols-4" aria-label="Nueva factura por cobrar" onSubmit={async (e) => {
      e.preventDefault();
      const ok = await onCreate({
        client: form.client.trim(), email: form.email.trim(), concept: form.concept.trim(), amount: form.amount,
        issued_date: form.issued_date || undefined, due_date: form.due_date, reference: form.reference.trim(),
        payment_link: form.payment_link.trim(), payment_terms: form.payment_terms.trim(), notes: form.notes.trim(),
      });
      if (ok) setForm(emptyForm());
    }}>
      <Field label="Cliente" className="sm:col-span-2"><input className="field field-sm" value={form.client} onChange={set("client")} maxLength={120} required /></Field>
      <Field label="Importe"><input className="field field-sm num" inputMode="decimal" value={form.amount} onChange={set("amount")} required placeholder="1.250,00" /></Field>
      <Field label="Vencimiento"><input type="date" className="field field-sm" value={form.due_date} onChange={set("due_date")} required /></Field>
      <Field label="Correo del cliente" className="sm:col-span-2"><input type="email" className="field field-sm" value={form.email} onChange={set("email")} maxLength={200} placeholder="cliente@ejemplo.com" /></Field>
      <Field label="Referencia"><input className="field field-sm" value={form.reference} onChange={set("reference")} maxLength={80} placeholder="2026-014" /></Field>
      <Field label="Emisión"><input type="date" className="field field-sm" value={form.issued_date} onChange={set("issued_date")} /></Field>
      <Field label="Concepto" className="sm:col-span-2"><input className="field field-sm" value={form.concept} onChange={set("concept")} maxLength={300} /></Field>
      <Field label="Enlace de pago" className="sm:col-span-2"><input className="field field-sm" value={form.payment_link} onChange={set("payment_link")} maxLength={500} placeholder="https://…" /></Field>
      <Field label="Cómo pagar" className="sm:col-span-4" help="Transferencia, cuenta, Bizum… Aparece en el segundo aviso.">
        <input className="field field-sm" value={form.payment_terms} onChange={set("payment_terms")} maxLength={2000} />
      </Field>
      <div className="flex gap-2 sm:col-span-4">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>Añadir</button>
        <button type="button" className="btn btn-sm" onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}

function EditForm({ item, onSave, onCancel, onDelete, busy }) {
  const fromItem = (r) => ({
    client: r.client, email: r.email || "", concept: r.concept || "", amount: centsToText(r.amount_cents), issued_date: r.issued_date,
    due_date: r.due_date, reference: r.reference || "", payment_link: r.payment_link || "", payment_terms: r.payment_terms || "", notes: r.notes || "",
  });
  const [form, setForm] = useState(() => fromItem(item));
  const [confirming, setConfirming] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <form className="mt-3 grid gap-3 border-t pt-3 sm:grid-cols-4" style={{ borderColor: "var(--line)" }} onSubmit={(e) => {
      e.preventDefault();
      onSave({
        client: form.client.trim(), email: form.email.trim(), concept: form.concept.trim(), amount: form.amount,
        issued_date: form.issued_date, due_date: form.due_date, reference: form.reference.trim(),
        payment_link: form.payment_link.trim(), payment_terms: form.payment_terms.trim(), notes: form.notes.trim(),
      });
    }}>
      <Field label="Cliente" className="sm:col-span-2"><input className="field field-sm" value={form.client} onChange={set("client")} maxLength={120} required /></Field>
      <Field label="Importe"><input className="field field-sm num" inputMode="decimal" value={form.amount} onChange={set("amount")} required /></Field>
      <Field label="Vencimiento"><input type="date" className="field field-sm" value={form.due_date} onChange={set("due_date")} required /></Field>
      <Field label="Correo del cliente" className="sm:col-span-2"><input type="email" className="field field-sm" value={form.email} onChange={set("email")} maxLength={200} /></Field>
      <Field label="Referencia"><input className="field field-sm" value={form.reference} onChange={set("reference")} maxLength={80} /></Field>
      <Field label="Emisión"><input type="date" className="field field-sm" value={form.issued_date} onChange={set("issued_date")} /></Field>
      <Field label="Concepto" className="sm:col-span-2"><input className="field field-sm" value={form.concept} onChange={set("concept")} maxLength={300} /></Field>
      <Field label="Enlace de pago" className="sm:col-span-2"><input className="field field-sm" value={form.payment_link} onChange={set("payment_link")} maxLength={500} /></Field>
      <Field label="Cómo pagar" className="sm:col-span-4"><input className="field field-sm" value={form.payment_terms} onChange={set("payment_terms")} maxLength={2000} /></Field>
      <Field label="Notas" className="sm:col-span-4"><input className="field field-sm" value={form.notes} onChange={set("notes")} maxLength={2000} /></Field>
      <div className="flex flex-wrap gap-2 sm:col-span-4">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>Guardar</button>
        <button type="button" className="btn btn-sm" onClick={onCancel}>Cancelar</button>
        <button type="button" className="btn btn-danger btn-sm ml-auto" onClick={() => setConfirming(true)} disabled={busy}>Borrar</button>
      </div>
      <ConfirmDialog open={confirming} title="Borrar factura"
        text={`Se quita la factura de ${item.client} con sus avisos. Los movimientos apuntados no se tocan.`}
        onCancel={() => setConfirming(false)} onConfirm={() => { setConfirming(false); onDelete(item); }} />
    </form>
  );
}

function NoticeCard({ notice, onSave, onSend, onDiscard, busy }) {
  const [subject, setSubject] = useState(notice.subject);
  const [body, setBody] = useState(notice.body);
  const [copied, setCopied] = useState(false);
  const dirty = subject !== notice.subject || body !== notice.body;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { setCopied(false); }
  };
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[13px] font-semibold">{notice.step_label} <span className="help font-normal">· {dateLabel(String(notice.ts).slice(0, 10))}</span></div>
        <span className="chip">{NOTICE_STATE[notice.state] || notice.state}</span>
      </div>
      {notice.state === "draft" ? (
        <div className="mt-2 grid gap-2">
          <Field label="Asunto"><input className="field field-sm" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} /></Field>
          <Field label="Texto"><textarea className="field field-sm min-h-[140px]" value={body} onChange={(e) => setBody(e.target.value)} /></Field>
          {notice.error && <p className="text-[12px]" style={{ color: "var(--danger-ink)" }}>No salió: {notice.error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onSend(notice, { subject, body })} disabled={busy}>Enviar</button>
            <button type="button" className="btn btn-sm" onClick={() => onSave(notice, { subject, body })} disabled={busy || !dirty}>Guardar texto</button>
            <button type="button" className="btn btn-sm" onClick={copy}>{copied ? "Copiado" : "Copiar"}</button>
            <button type="button" className="btn btn-sm ml-auto" onClick={() => onDiscard(notice)} disabled={busy}>Descartar</button>
          </div>
        </div>
      ) : (
        <div className="mt-1">
          <div className="text-[13px]">{notice.subject}</div>
          <pre className="help mt-1 whitespace-pre-wrap text-[12px]">{notice.body}</pre>
        </div>
      )}
    </li>
  );
}

function Detail({ id, onChanged, busy, run }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    try {
      setData(await api.receivables.get(id));
      setError(null);
    } catch (e) { setError(e.message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn, okText) => {
    const out = await run(fn, okText);
    if (out) { await load(); await onChanged(); }
    return out;
  };

  if (error) return <p className="text-[13px]" style={{ color: "var(--danger-ink)" }}>{error}</p>;
  if (!data) return <p className="help text-[13px]">Cargando…</p>;
  const r = data.receivable;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-[15px] font-semibold">{r.client}</div>
          <div className="help text-[12px]">{r.concept || "Sin concepto"}{r.reference ? ` · ${r.reference}` : ""}</div>
        </div>
        <div className="text-right">
          <div className="num text-[18px] font-semibold">{r.amount}</div>
          <div className="help text-[12px]">vence {dateLabel(r.due_date)}{r.days_overdue > 0 && r.status !== "paid" ? ` · ${r.days_overdue} días de retraso` : ""}</div>
        </div>
      </div>
      <dl className="grid grid-cols-[130px_1fr] gap-y-1 text-[13px]">
        <dt className="help">Estado</dt><dd><span className={STATUS_CHIP[r.status] || "chip"}>{STATUS[r.status] || r.status}</span></dd>
        <dt className="help">Emisión</dt><dd className="num">{dateLabel(r.issued_date)}</dd>
        <dt className="help">Correo</dt><dd>{r.email || <span className="help">sin correo: no se pueden enviar avisos</span>}</dd>
        {r.payment_link && <><dt className="help">Enlace de pago</dt><dd className="break-all">{r.payment_link}</dd></>}
        {r.payment_terms && <><dt className="help">Cómo pagar</dt><dd>{r.payment_terms}</dd></>}
        {r.paid_date && <><dt className="help">Cobrada</dt><dd className="num">{dateLabel(r.paid_date)}</dd></>}
        {r.notes && <><dt className="help">Notas</dt><dd>{r.notes}</dd></>}
      </dl>

      {data.proposals.filter((p) => p.state === "pending").length > 0 && (
        <div className="rounded-md border p-3" style={{ background: "var(--warn-bg)", borderColor: "var(--line)" }}>
          <div className="text-[13px] font-semibold">Pagos que pueden ser esta factura</div>
          <ul className="mt-1 space-y-2 text-[13px]">
            {data.proposals.filter((p) => p.state === "pending").map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{dateLabel(p.date)} · {p.amount} · {p.counterparty || "sin contraparte"} <span className="help">({p.reason})</span></span>
                <span className="flex gap-2">
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy}
                    onClick={() => act(() => api.receivables.acceptProposal(p.id), "Cobrada. Hay un agradecimiento en borradores.")}>Es esta</button>
                  <button type="button" className="btn btn-sm" disabled={busy}
                    onClick={() => act(() => api.receivables.dismissProposal(p.id), "Propuesta descartada.")}>No</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="text-[14px] font-semibold">Avisos</h3>
        {data.notices.length ? (
          <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
            {data.notices.map((n) => (
              <NoticeCard key={n.id} notice={n} busy={busy}
                onSave={(notice, patch) => act(() => api.receivables.editNotice(notice.id, patch), "Texto guardado.")}
                onSend={(notice, patch) => act(async () => {
                  if (patch.subject !== notice.subject || patch.body !== notice.body) await api.receivables.editNotice(notice.id, patch);
                  const out = await api.receivables.sendNotice(notice.id);
                  if (!out.sent) throw new Error(`No se pudo enviar: ${out.error}. El texto queda listo para copiar.`);
                  return out;
                }, "Aviso enviado.")}
                onDiscard={(notice) => act(() => api.receivables.discardNotice(notice.id), "Aviso descartado.")} />
            ))}
          </ul>
        ) : <p className="help text-[13px]">Todavía no hay avisos. Se preparan solos al vencer la factura.</p>}
      </div>
    </div>
  );
}

export default function Cobros() {
  const { notify } = useApp();
  const [data, setData] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [run, busy] = useAction(notify);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(null);
  const [sort, setSort] = useState({ key: "due_date", order: "asc" });
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    try {
      const [list, d, p] = await Promise.all([api.receivables.list(), api.receivables.drafts(), api.receivables.proposals()]);
      setData(list);
      setDrafts(d.drafts);
      setProposals(p.proposals);
    } catch (e) {
      notify({ kind: "error", text: e.message });
    }
  }, [notify]);
  useEffect(() => { load(); }, [load]);
  useCopilotRefresh(() => { load(); });

  const create = async (payload) => {
    const out = await run(() => api.receivables.create(payload), `${payload.client}: factura añadida.`);
    if (out) { setAdding(false); await load(); }
    return !!out;
  };
  const save = async (item, patch) => {
    const out = await run(() => api.receivables.update(item.id, patch), "Factura guardada.");
    if (out) { setEditing(null); await load(); }
    return !!out;
  };
  const remove = async (item) => {
    const out = await run(() => api.receivables.remove(item.id), "Factura borrada.");
    if (out) { setEditing(null); if (open === item.id) setOpen(null); await load(); }
  };
  const markPaid = async (item) => {
    const out = await run(() => api.receivables.paid(item.id), `${item.client}: marcada como cobrada.`);
    if (out) await load();
  };
  const pause = async (item, paused) => {
    const out = await run(() => api.receivables.pause(item.id, paused), paused ? "Cobro en pausa." : "Cobro reanudado.");
    if (out) await load();
  };
  const check = async () => {
    const out = await run(() => api.receivables.check(), null);
    if (out) {
      const sent = out.drafts.filter((d) => d.delivery?.sent).length;
      const n = out.drafts.length - sent;
      const e = out.escalated.length;
      notify({ kind: "ok", text: n || e || sent ? `${n} ${n === 1 ? "borrador" : "borradores"}, ${sent} ${sent === 1 ? "correo enviado" : "correos enviados"} y ${e} ${e === 1 ? "aviso al usuario" : "avisos al usuario"}.` : "No hay nada nuevo que reclamar." });
      await load();
    }
  };
  const sweep = async () => {
    const out = await run(() => api.receivables.sweep(), null);
    if (out) {
      notify({ kind: "ok", text: out.proposals.length ? `${out.proposals.length} pagos que pueden ser facturas.` : "Ningún ingreso casa con una factura pendiente." });
      await load();
    }
  };

  const items = (data?.receivables || []).filter((r) => !filter || r.status === filter);
  const sorted = [...items].sort((a, b) => {
    const key = { due_date: "due_date", client: "client", amount: "amount_cents", days: "days_overdue", status: "status" }[sort.key] || "due_date";
    const x = a[key], y = b[key];
    const cmp = typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""), "es");
    return (sort.order === "desc" ? -1 : 1) * cmp;
  });
  const head = (key, label, align = "text-left") => (
    <th className={`${align} px-2 py-2`} scope="col">
      <button type="button" className="btn-link text-[12px] font-semibold" onClick={() => setSort((s) => ({ key, order: s.key === key && s.order === "asc" ? "desc" : "asc" }))}>
        {label}{sort.key === key ? (sort.order === "asc" ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );

  return (
    <Page
      title="Cobros"
      description="Facturas emitidas a clientes, con su vencimiento y los avisos que se preparan solos."
      actions={<div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>Nueva factura</button>
        <button type="button" className="btn" onClick={check} disabled={busy}>Comprobar ahora</button>
        <button type="button" className="btn" onClick={sweep} disabled={busy}>Buscar pagos</button>
      </div>}
    >
      {!data ? <p className="help">Cargando…</p> : (
        <div className="space-y-4">
          {adding && <NewForm busy={busy} onCreate={create} onCancel={() => setAdding(false)} />}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="panel"><div className="label">Pendiente</div><div className="num text-[22px] font-semibold">{data.summary.pending}</div><div className="help text-[11px]">{data.summary.counts.pending} {data.summary.counts.pending === 1 ? "factura" : "facturas"}</div></div>
            <div className="panel"><div className="label">Vencido</div><div className="num text-[22px] font-semibold expense">{data.summary.overdue}</div><div className="help text-[11px]">{data.summary.counts.overdue} {data.summary.counts.overdue === 1 ? "factura" : "facturas"}</div></div>
            <div className="panel"><div className="label">Cobrado este mes</div><div className="num text-[22px] font-semibold income">{data.summary.paid}</div><div className="help text-[11px]">{data.summary.counts.paid} {data.summary.counts.paid === 1 ? "factura" : "facturas"}</div></div>
            <div className="panel"><div className="label">Borradores</div><div className="num text-[22px] font-semibold">{data.summary.drafts}</div><div className="help text-[11px]">{data.summary.proposals} pagos por confirmar</div></div>
          </div>

          <Section title="Facturas" aside={
            <select className="field field-sm w-[150px]" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrar por estado">
              <option value="">Todas</option>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          }>
            {sorted.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b" style={{ borderColor: "var(--line)" }}>
                      {head("client", "Cliente")}
                      {head("due_date", "Vence")}
                      {head("amount", "Importe", "text-right")}
                      {head("days", "Retraso", "text-right")}
                      {head("status", "Estado")}
                      <th scope="col" className="px-2 py-2 text-right text-[12px] font-semibold">Avisos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((r) => (
                      <React.Fragment key={r.id}>
                        <tr className="border-b align-top" style={{ borderColor: "var(--line)" }}>
                          <td className="px-2 py-2">
                            <button type="button" className="btn-link text-left font-semibold" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                              {r.client}
                            </button>
                            <div className="help text-[11px]">{r.concept || "—"}{r.reference ? ` · ${r.reference}` : ""}</div>
                          </td>
                          <td className="num px-2 py-2">{dateLabel(r.due_date)}</td>
                          <td className="num px-2 py-2 text-right">{r.amount}</td>
                          <td className="num px-2 py-2 text-right">{r.status === "paid" ? "—" : r.days_overdue > 0 ? `${r.days_overdue} d` : <span className="help">—</span>}</td>
                          <td className="px-2 py-2"><span className={STATUS_CHIP[r.status] || "chip"}>{STATUS[r.status] || r.status}</span></td>
                          <td className="px-2 py-2 text-right">
                            {r.notices_count ? <span className="help text-[12px]">{r.notices_count}{r.drafts_count ? ` · ${r.drafts_count} en borrador` : ""}</span> : <span className="help text-[12px]">—</span>}
                          </td>
                        </tr>
                        {open === r.id && (
                          <tr>
                            <td colSpan={6} className="px-2 pb-4">
                              <div className="panel-white">
                                <Detail id={r.id} busy={busy} run={run} onChanged={load} />
                                <div className="mt-3 flex flex-wrap gap-2 border-t pt-3" style={{ borderColor: "var(--line)" }}>
                                  {r.status !== "paid" && <button type="button" className="btn btn-primary btn-sm" onClick={() => markPaid(r)} disabled={busy}>Marcar cobrada</button>}
                                  {r.status === "pending" || r.status === "overdue"
                                    ? <button type="button" className="btn btn-sm" onClick={() => pause(r, true)} disabled={busy}>Pausar</button>
                                    : r.status === "paused" ? <button type="button" className="btn btn-sm" onClick={() => pause(r, false)} disabled={busy}>Reanudar</button> : null}
                                  <button type="button" className="btn btn-sm" onClick={() => setEditing(editing === r.id ? null : r.id)}>{editing === r.id ? "Cerrar" : "Editar"}</button>
                                </div>
                                {editing === r.id && (
                                  <EditForm item={r} busy={busy} onCancel={() => setEditing(null)}
                                    onSave={(patch) => save(r, patch)} onDelete={remove} />
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty text={filter ? "Ninguna factura con ese estado." : "Todavía no hay facturas. Añade una con «Nueva factura» y los avisos se preparan solos al vencer."} />}
          </Section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Borradores de aviso">
              {drafts.length ? (
                <ul className="divide-y text-[13px]" style={{ borderColor: "var(--line)" }}>
                  {drafts.map((d) => (
                    <li key={d.id} className="py-2">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-semibold">{d.client} · {d.amount}</span>
                        <span className="help text-[12px]">{d.step_label}</span>
                      </div>
                      <div className="help text-[12px]">{d.subject}</div>
                      <div className="mt-1 flex flex-wrap gap-2">
                        <button type="button" className="btn btn-sm" onClick={() => { setOpen(d.receivable_id); setFilter(""); }}>Ver factura</button>
                        <button type="button" className="btn btn-sm" disabled={busy}
                          onClick={async () => {
                            const out = await run(() => api.receivables.sendNotice(d.id), null);
                            if (out) {
                              notify({ kind: out.sent ? "ok" : "error", text: out.sent ? "Aviso enviado." : `No se pudo enviar: ${out.error}. El texto queda en la factura para copiar.` });
                              await load();
                            }
                          }}>Enviar</button>
                        <button type="button" className="btn btn-sm" disabled={busy}
                          onClick={async () => { const out = await run(() => api.receivables.discardNotice(d.id), "Aviso descartado."); if (out) await load(); }}>Descartar</button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <p className="help">No hay borradores esperando.</p>}
            </Section>

            <Section title="Pagos por confirmar">
              {proposals.length ? (
                <ul className="divide-y text-[13px]" style={{ borderColor: "var(--line)" }}>
                  {proposals.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>
                        <span className="font-semibold">{p.client}</span> · {p.amount}
                        <div className="help text-[12px]">{dateLabel(p.entry_date)} · {p.counterparty || "sin contraparte"} · {p.reason}</div>
                      </span>
                      <span className="flex gap-2">
                        <button type="button" className="btn btn-primary btn-sm" disabled={busy}
                          onClick={async () => { const out = await run(() => api.receivables.acceptProposal(p.id), "Cobrada. Hay un agradecimiento en borradores."); if (out) await load(); }}>Es esta</button>
                        <button type="button" className="btn btn-sm" disabled={busy}
                          onClick={async () => { const out = await run(() => api.receivables.dismissProposal(p.id), "Propuesta descartada."); if (out) await load(); }}>No</button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : <p className="help">Ningún ingreso casa con una factura pendiente.</p>}
            </Section>
          </div>

          <Section title="Plazos y tono">
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Primer aviso (días)" help="Tras el vencimiento.">
                <input className="field field-sm num" inputMode="numeric" defaultValue={data.settings.step1_days}
                  onBlur={async (e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n !== data.settings.step1_days) { const out = await run(() => api.receivables.saveSettings({ step1_days: n }), "Plazos guardados."); if (out) await load(); } }} />
              </Field>
              <Field label="Segundo aviso (días)" help="Más firme, con importe y forma de pago.">
                <input className="field field-sm num" inputMode="numeric" defaultValue={data.settings.step2_days}
                  onBlur={async (e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n !== data.settings.step2_days) { const out = await run(() => api.receivables.saveSettings({ step2_days: n }), "Plazos guardados."); if (out) await load(); } }} />
              </Field>
              <Field label="Aviso al usuario (días)" help="Deja de escribir al cliente.">
                <input className="field field-sm num" inputMode="numeric" defaultValue={data.settings.escalate_days}
                  onBlur={async (e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n !== data.settings.escalate_days) { const out = await run(() => api.receivables.saveSettings({ escalate_days: n }), "Plazos guardados."); if (out) await load(); } }} />
              </Field>
              <Field label="Tono">
                <select className="field field-sm" value={data.settings.tone}
                  onChange={async (e) => { const out = await run(() => api.receivables.saveSettings({ tone: e.target.value }), "Tono guardado."); if (out) await load(); }}>
                  {Object.entries(TONE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="Firma" className="sm:col-span-2" help="Se añade al final de cada aviso.">
                <input className="field field-sm" defaultValue={data.settings.signature} maxLength={120}
                  onBlur={async (e) => { const v = e.target.value.trim(); if (v !== data.settings.signature) { const out = await run(() => api.receivables.saveSettings({ signature: v }), "Firma guardada."); if (out) await load(); } }} />
              </Field>
              <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
                <input type="checkbox" checked={data.settings.auto_draft}
                  onChange={async (e) => { const out = await run(() => api.receivables.saveSettings({ auto_draft: e.target.checked }), "Guardado."); if (out) await load(); }} />
                Preparar los borradores sola cada mañana
              </label>
              <label className="flex items-start gap-2 text-[13px] sm:col-span-2">
                <input type="checkbox" checked={Boolean(data.settings.auto_send)} disabled={busy}
                  onChange={async (e) => { const out = await run(() => api.receivables.saveSettings({ auto_send: e.target.checked }), "Guardado."); if (out) await load(); }} />
                <span>Enviar automáticamente los nuevos avisos preparados
                  <span className="block text-muted">Salen desde tu cuenta conectada. Si el envío falla, el aviso queda como borrador para revisarlo.</span>
                </span>
              </label>
            </div>
          </Section>
        </div>
      )}
    </Page>
  );
}
