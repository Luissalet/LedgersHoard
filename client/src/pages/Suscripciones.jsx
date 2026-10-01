import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { Page, Section, Empty, Field, useAction } from "../components/ui.jsx";
import { centsToText, dateLabel } from "../format.js";

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
        {history.slice(-4).map((h, i) => <li key={`${h.date}-${i}`}>{dateLabel(h.date)} · {money(h.amount_cents, h.currency || currency)}</li>)}
      </ul>
    </div>
  );
}

function EditForm({ sub, categories, accounts, onSave, onCancel, busy }) {
  const [form, setForm] = useState({
    amount: centsToText(sub.amount_cents), period: sub.period, next_charge_date: sub.next_charge_date || "",
    category_id: sub.category_id || "", notes: sub.notes || "",
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <form
      className="panel mt-3 grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ amount: form.amount, period: form.period, next_charge_date: form.next_charge_date || null, category_id: form.category_id || null, notes: form.notes });
      }}
    >
      <Field label="Importe"><input className="field field-sm num" inputMode="decimal" value={form.amount} onChange={set("amount")} required /></Field>
      <Field label="Periodo">
        <select className="field field-sm" value={form.period} onChange={set("period")}>
          {Object.entries(PERIOD).map(([k, v]) => <option key={k} value={k}>{k === "unknown" ? "Sin determinar" : v}</option>)}
        </select>
      </Field>
      <Field label="Próximo cobro"><input type="date" className="field field-sm" value={form.next_charge_date} onChange={set("next_charge_date")} /></Field>
      <Field label="Categoría">
        <select className="field field-sm" value={form.category_id} onChange={set("category_id")}>
          <option value="">Sin categoría</option>
          {categories.filter((c) => c.kind === "expense" && !c.archived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Notas" className="sm:col-span-2"><input className="field field-sm" value={form.notes} onChange={set("notes")} maxLength={300} /></Field>
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>Guardar</button>
        <button type="button" className="btn btn-sm" onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}

function Card({ sub, categories, accounts, onPatch, busy }) {
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
        <dt className="help">Próximo cobro</dt><dd className="num">{sub.next_charge_date ? dateLabel(sub.next_charge_date) : <span className="help">—</span>}</dd>
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
      {editing && <EditForm sub={sub} categories={categories} accounts={accounts} busy={busy} onCancel={() => setEditing(false)} onSave={async (patch) => { if (await onPatch(sub, patch, "Suscripción guardada.")) setEditing(false); }} />}
    </article>
  );
}

export default function Suscripciones() {
  const { categories, accounts, notify } = useApp();
  const [data, setData] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [run, busy] = useAction(notify);

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

  const patch = async (sub, change, okText) => {
    const out = await run(() => api.subscriptions.update(sub.id, change), okText);
    if (out) await load();
    return !!out;
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
      actions={<button type="button" className="btn" onClick={detect} disabled={busy}>Buscar en movimientos</button>}
    >
      {!data ? <p className="help">Cargando…</p> : (
        <div className="space-y-4">
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
                  <div className="grid gap-3 md:grid-cols-2">{live.map((s) => <Card key={s.id} sub={s} categories={categories} accounts={accounts} onPatch={patch} busy={busy} />)}</div>
                ) : <Empty text="Todavía no hay suscripciones. Aparecen solas al leer el correo, o con «Buscar en movimientos»." />}
              </Section>
              {other.length > 0 && (
                <Section title="En pausa o canceladas">
                  <div className="grid gap-3 md:grid-cols-2">{other.map((s) => <Card key={s.id} sub={s} categories={categories} accounts={accounts} onPatch={patch} busy={busy} />)}</div>
                </Section>
              )}
            </div>
            <div className="space-y-4">
              <Section title="Próximos 30 días">
                {data.upcoming.length ? (
                  <ul className="divide-y text-[13px]" style={{ borderColor: "var(--line)" }}>
                    {data.upcoming.map((u, i) => (
                      <li key={`${u.id}-${u.kind}-${i}`} className="flex items-baseline justify-between gap-2 py-2">
                        <span>{u.merchant} {u.kind === "trial_end" && <span className="chip chip-warn ml-1">Fin de la prueba</span>}</span>
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
