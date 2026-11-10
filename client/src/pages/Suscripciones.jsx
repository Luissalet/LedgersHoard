import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { Page, Section, Empty, Field, ConfirmDialog, useAction } from "../components/ui.jsx";
import { centsToText, dateLabel } from "../format.js";
import { changedFields, rebaseForm } from "../copilot-context.js";
import { useCopilotContext, useCopilotRefresh } from "../copilot-hooks.js";

const PERIOD = { monthly: "al mes", yearly: "al año", weekly: "a la semana", unknown: "periodo sin determinar" };
const STATUS = { active: "Activa", trial: "Prueba", cancelled: "Cancelada", paused: "Pausada" };
const STATUS_CHIP = { active: "chip chip-income", trial: "chip chip-warn", cancelled: "chip chip-danger", paused: "chip" };

function money(cents, currency) {
  try {
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: currency || "EUR" }).format(cents / 100);
  } catch {
    return `${centsToText(cents)} ${currency}`;
  }
}

function History({ history, currency }) {
  if (!history?.length || history.length < 2) return <span className="help text-[11px]">Sin cambios de precio</span>;
  const max = Math.max(...history.map((h) => h.amount_cents));
  const min = Math.min(...history.map((h) => h.amount_cents));
  return (
    <div>
      <div className="flex items-end gap-[3px]" style={{ height: 28 }} role="img" aria-label={`Historial de precio: ${history.map((h) => money(h.amount_cents, h.currency || currency)).join(", ")}`}>
        {history.map((h, i) => {
          const pct = max === min ? 60 : 30 + ((h.amount_cents - min) / (max - min)) * 70;
          return <span key={`${h.date}-${i}`} title={`${dateLabel(h.date)}: ${money(h.amount_cents, h.currency || currency)}`} style={{ width: 8, height: `${pct}%`, background: "var(--accent)", borderRadius: 2, opacity: i === history.length - 1 ? 1 : 0.55 }} />;
        })}
      </div>
      <ul className="help mt-1 text-[11px]">
        {history.slice(-4).map((h, i) => <li key={`${h.date}-${i}`}>{dateLabel(h.date)} · {money(h.amount_cents, h.currency || currency)}{h.extra && <span title="Segundo cargo dentro del mismo periodo: no cambia el precio ni la fecha"> · cargo extra</span>}</li>)}
      </ul>
    </div>
  );
}

function EditForm({ sub, categories, accounts, onSave, onCancel, onDelete, busy }) {
  const fromSub = (s) => ({
    merchant: s.merchant, amount: centsToText(s.amount_cents), currency: s.currency || "EUR", period: s.period, next_charge_date: s.next_charge_date || "",
    trial_end_date: s.trial_end_date || "", category_id: s.category_id || "", account_id: s.account_id || "", notes: s.notes || "",
  });
  const [confirming, setConfirming] = useState(false);
  const [form, setForm] = useState(() => fromSub(sub));
  const [base, setBase] = useState(() => fromSub(sub));   // only the fields the user changes are saved
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const subKey = JSON.stringify(fromSub(sub));
  useEffect(() => {
    const next = fromSub(sub);
    if (JSON.stringify(next) === JSON.stringify(base)) return;
    setForm((f) => rebaseForm(base, next, f));
    setBase(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subKey]);
  const changed = changedFields(base, form);
  useCopilotContext(() => ({ editors: [{ kind: "subscription-form", object_id: sub.id, dirty: Object.keys(changed).length > 0, fields: form, changed }] }));
  return (
    <form
      className="panel mt-3 grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const payload = {
          merchant: form.merchant.trim(), amount: form.amount, currency: form.currency.trim().toUpperCase(), period: form.period,
          next_charge_date: form.next_charge_date || null, trial_end_date: form.trial_end_date || null,
          category_id: form.category_id || null, account_id: form.account_id || null, notes: form.notes,
        };
        onSave(Object.fromEntries(Object.entries(payload).filter(([k]) => k in changed)));
      }}
    >
      <Field label="Nombre" className="sm:col-span-2"><input className="field field-sm" value={form.merchant} onChange={set("merchant")} maxLength={80} required /></Field>
      <Field label="Importe"><input className="field field-sm num" inputMode="decimal" value={form.amount} onChange={set("amount")} required /></Field>
      <Field label="Divisa"><input className="field field-sm w-[90px] uppercase" value={form.currency} onChange={set("currency")} maxLength={3} minLength={3} required /></Field>
      <Field label="Periodo">
        <select className="field field-sm" value={form.period} onChange={set("period")}>
          {Object.entries(PERIOD).map(([k, v]) => <option key={k} value={k}>{k === "unknown" ? "Sin determinar" : v}</option>)}
        </select>
      </Field>
      <Field label="Próximo cobro"><input type="date" className="field field-sm" value={form.next_charge_date} onChange={set("next_charge_date")} /></Field>
      <Field label="Fin de la prueba"><input type="date" className="field field-sm" value={form.trial_end_date} onChange={set("trial_end_date")} /></Field>
      <Field label="Categoría">
        <select className="field field-sm" value={form.category_id} onChange={set("category_id")}>
          <option value="">Sin categoría</option>
          {categories.filter((c) => c.kind === "expense" && !c.archived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Cuenta del cobro">
        <select className="field field-sm" value={form.account_id} onChange={set("account_id")}>
          <option value="">Sin indicar</option>
          {accounts.filter((a) => !a.archived || a.id === form.account_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Field>
      <Field label="Notas" className="sm:col-span-2"><input className="field field-sm" value={form.notes} onChange={set("notes")} maxLength={300} /></Field>
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>Guardar</button>
        <button type="button" className="btn btn-sm" onClick={onCancel}>Cancelar</button>
        <button type="button" className="btn btn-danger btn-sm ml-auto" onClick={() => setConfirming(true)} disabled={busy}>Borrar</button>
      </div>
      <ConfirmDialog open={confirming} title="Borrar suscripción"
        text={`Se quita «${sub.merchant}» de la lista con su historial de precios. Los movimientos apuntados no se tocan. Si solo te has dado de baja, usa «Cancelada».`}
        onCancel={() => setConfirming(false)} onConfirm={() => { setConfirming(false); onDelete(sub); }} />
    </form>
  );
}

function Card({ sub, categories, accounts, onPatch, onDelete, busy }) {
  const [editing, setEditing] = useState(false);
  const category = categories.find((c) => c.id === sub.category_id);
  const dim = sub.status === "cancelled" || sub.status === "paused";
  return (
    <article className="panel" style={dim ? { opacity: 0.72 } : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[16px] font-semibold">{sub.merchant}</h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <span className={STATUS_CHIP[sub.status] || "chip"}>{STATUS[sub.status] || sub.status}</span>
            {category && <span className="chip">{category.name}</span>}
            {sub.source === "mail" && <span className="chip">del correo</span>}
          </div>
        </div>
        <div className="text-right">
          <div className="num text-[18px] font-semibold">{sub.amount_text}</div>
          <div className="help text-[12px]">{PERIOD[sub.period] || sub.period}</div>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-[110px_1fr] gap-y-1 text-[13px]">
        <dt className="help">Próximo cobro</dt><dd className="num">{sub.next_charge ? <>{dateLabel(sub.next_charge)}{sub.next_charge_estimated && <span className="help" title={`El correo daba el ${dateLabel(sub.next_charge_date)}; el cobro de ese día no ha llegado.`}> (estimado)</span>}</> : <span className="help">—</span>}</dd>
        <dt className="help">Último cobro</dt><dd className="num">{sub.last_charge_date ? dateLabel(sub.last_charge_date) : <span className="help">—</span>}</dd>
        {sub.trial_end_date && <><dt className="help">Fin de la prueba</dt><dd className="num">{dateLabel(sub.trial_end_date)}</dd></>}
        {sub.monthly_cents != null && sub.period !== "monthly" && <><dt className="help">Equivale a</dt><dd className="num">{money(sub.monthly_cents, sub.currency)} al mes</dd></>}
      </dl>
      <div className="mt-3"><History history={sub.price_history} currency={sub.currency} /></div>
      {sub.notes && <p className="help mt-2 text-[12px]">{sub.notes}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {sub.status !== "cancelled" && <button type="button" className="btn btn-sm" onClick={() => onPatch(sub, { status: "cancelled" }, `${sub.merchant}: marcada como cancelada.`)} disabled={busy}>Cancelada</button>}
        {sub.status === "active" && <button type="button" className="btn btn-sm" onClick={() => onPatch(sub, { status: "paused" }, `${sub.merchant}: en pausa.`)} disabled={busy}>Pausada</button>}
        {sub.status !== "active" && <button type="button" className="btn btn-sm" onClick={() => onPatch(sub, { status: "active" }, `${sub.merchant}: activa otra vez.`)} disabled={busy}>Activar</button>}
        <button type="button" className="btn btn-sm" onClick={() => setEditing((v) => !v)}>{editing ? "Cerrar" : "Editar"}</button>
      </div>
      {editing && <EditForm sub={sub} categories={categories} accounts={accounts} busy={busy} onCancel={() => setEditing(false)} onDelete={onDelete} onSave={async (patch) => { if (!Object.keys(patch).length) { setEditing(false); return; } if (await onPatch(sub, patch, "Suscripción guardada.")) setEditing(false); }} />}
    </article>
  );
}

function NewForm({ categories, accounts, onCreate, onCancel, busy }) {
  const empty = { merchant: "", amount: "", currency: "EUR", period: "monthly", next_charge_date: "", trial_end_date: "", category_id: "", account_id: "", notes: "" };
  const [form, setForm] = useState(empty);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  useCopilotContext(() => ({ editors: [{ kind: "subscription-form", object_id: null, dirty: !!(form.merchant || form.amount), fields: form, changed: {} }] }));
  return (
    <form className="panel grid gap-3 sm:grid-cols-4" aria-label="Nueva suscripción" onSubmit={async (e) => {
      e.preventDefault();
      const ok = await onCreate({
        merchant: form.merchant.trim(), amount: form.amount, currency: form.currency.trim().toUpperCase() || "EUR", period: form.period,
        status: form.trial_end_date ? "trial" : "active", next_charge_date: form.next_charge_date || null, trial_end_date: form.trial_end_date || null,
        category_id: form.category_id || null, account_id: form.account_id || null, notes: form.notes,
      });
      if (ok) setForm(empty);
    }}>
      <Field label="Servicio" className="sm:col-span-2"><input className="field field-sm" value={form.merchant} onChange={set("merchant")} maxLength={80} required placeholder="Netflix" /></Field>
      <Field label="Importe"><input className="field field-sm num" inputMode="decimal" value={form.amount} onChange={set("amount")} required placeholder="12,99" /></Field>
      <Field label="Periodo">
        <select className="field field-sm" value={form.period} onChange={set("period")}>
          <option value="monthly">Mensual</option><option value="yearly">Anual</option><option value="weekly">Semanal</option>
        </select>
      </Field>
      <Field label="Próximo cobro"><input type="date" className="field field-sm" value={form.next_charge_date} onChange={set("next_charge_date")} /></Field>
      <Field label="Fin de la prueba" help="Solo si es una prueba gratuita."><input type="date" className="field field-sm" value={form.trial_end_date} onChange={set("trial_end_date")} /></Field>
      <Field label="Categoría">
        <select className="field field-sm" value={form.category_id} onChange={set("category_id")}>
          <option value="">Sin categoría</option>
          {categories.filter((c) => c.kind === "expense" && !c.archived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Divisa"><input className="field field-sm w-[90px] uppercase" value={form.currency} onChange={set("currency")} maxLength={3} minLength={3} required /></Field>
      <div className="flex gap-2 sm:col-span-4">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>Añadir</button>
        <button type="button" className="btn btn-sm" onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}

export default function Suscripciones() {
  const { categories, accounts, notify } = useApp();
  const [data, setData] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [run, busy] = useAction(notify);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const [subs, notes] = await Promise.all([api.subscriptions.list(30), api.mail.notifications(60)]);
      setData(subs);
      setAlerts(notes.notifications.filter((n) => n.kind.startsWith("subscription") || n.kind === "payment.failed" || n.kind.includes("trial") || n.kind.includes("price")).slice(0, 8));
    } catch (e) {
      notify({ kind: "error", text: e.message });
    }
  }, [notify]);
  useEffect(() => { load(); }, [load]);
  useCopilotRefresh(() => { load(); });

  const patch = async (sub, change, okText) => {
    const out = await run(() => api.subscriptions.update(sub.id, change), okText);
    if (out) await load();
    return !!out;
  };
  const create = async (data) => {
    const out = await run(() => api.subscriptions.create(data), `${data.merchant}: añadida.`);
    if (out) { setAdding(false); await load(); }
    return !!out;
  };
  const remove = async (sub) => {
    const out = await run(() => api.subscriptions.remove(sub.id), `${sub.merchant}: borrada.`);
    if (out) await load();
  };
  const detect = async () => {
    const out = await run(() => api.subscriptions.detect());
    if (out) {
      notify({ kind: "ok", text: out.created.length ? `Encontradas ${out.created.length} suscripciones en tus movimientos.` : "No hay suscripciones nuevas en tus movimientos." });
      await load();
    }
  };

  const subs = data?.subscriptions || [];
  const live = subs.filter((s) => s.status === "active" || s.status === "trial");
  const other = subs.filter((s) => s.status === "paused" || s.status === "cancelled");

  return (
    <Page
      title="Suscripciones"
      description="Las que aparecen en tu correo o se repiten en tus movimientos, con su coste mensual y anual."
      actions={<div className="flex flex-wrap gap-2"><button type="button" className="btn btn-primary" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>Nueva suscripción</button><button type="button" className="btn" onClick={detect} disabled={busy}>Buscar en movimientos</button></div>}
    >
      {!data ? <p className="help">Cargando…</p> : (
        <div className="space-y-4">
          {adding && <NewForm categories={categories} accounts={accounts} busy={busy} onCreate={create} onCancel={() => setAdding(false)} />}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {data.totals.length ? data.totals.map((t) => (
              <React.Fragment key={t.currency}>
                <div className="panel"><div className="label">Al mes ({t.currency})</div><div className="num text-[22px] font-semibold expense">{t.monthly_text}</div></div>
                <div className="panel"><div className="label">Al año ({t.currency})</div><div className="num text-[22px] font-semibold expense">{t.yearly_text}</div></div>
              </React.Fragment>
            )) : (
              <div className="panel col-span-2"><div className="label">Coste mensual</div><div className="num text-[22px] font-semibold">—</div></div>
            )}
            <div className="panel"><div className="label">Activas</div><div className="num text-[22px] font-semibold">{live.length}</div></div>
            {data.unknown_period > 0 && <div className="panel"><div className="label">Sin periodo</div><div className="num text-[22px] font-semibold">{data.unknown_period}</div><div className="help text-[11px]">No suman al total</div></div>}
          </div>

          <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
            <div className="space-y-4">
              <Section title="Activas">
                {live.length ? (
                  <div className="grid gap-3 md:grid-cols-2">{live.map((s) => <Card key={s.id} sub={s} categories={categories} accounts={accounts} onPatch={patch} onDelete={remove} busy={busy} />)}</div>
                ) : <Empty text="Todavía no hay suscripciones. Aparecen solas al leer el correo, con «Buscar en movimientos» o con «Nueva suscripción»." />}
              </Section>
              {other.length > 0 && (
                <Section title="En pausa o canceladas">
                  <div className="grid gap-3 md:grid-cols-2">{other.map((s) => <Card key={s.id} sub={s} categories={categories} accounts={accounts} onPatch={patch} onDelete={remove} busy={busy} />)}</div>
                </Section>
              )}
            </div>
            <div className="space-y-4">
              <Section title="Próximos 30 días">
                {data.upcoming.length ? (
                  <ul className="divide-y text-[13px]" style={{ borderColor: "var(--line)" }}>
                    {data.upcoming.map((u, i) => (
                      <li key={`${u.id}-${u.kind}-${i}`} className="flex items-baseline justify-between gap-2 py-2">
                        <span>{u.merchant} {u.kind === "trial_end" && <span className="chip chip-warn ml-1">Fin de la prueba</span>}{u.estimated && <span className="chip ml-1" title="Fecha calculada desde el último cobro conocido">estimado</span>}</span>
                        <span className="num whitespace-nowrap">{dateLabel(u.date)} · {u.amount_text}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="help">Ningún cobro previsto en los próximos 30 días.</p>}
              </Section>
              <Section title="Avisos">
                {alerts.length ? (
                  <ul className="divide-y text-[13px]" style={{ borderColor: "var(--line)" }}>
                    {alerts.map((n) => (
                      <li key={n.id} className="py-2">
                        <div className="font-semibold">{n.title}</div>
                        {n.body && <div className="help text-[12px]">{n.body}</div>}
                      </li>
                    ))}
                  </ul>
                ) : <p className="help">Sin subidas de precio ni pruebas a punto de acabar.</p>}
              </Section>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}
