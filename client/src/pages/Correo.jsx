import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { Page, Section, Empty, Field, ConfirmDialog, MonthPicker, useAction } from "../components/ui.jsx";
import { centsToText, dateLabel, monthLabel, thisMonth } from "../format.js";

const KIND_LABEL = { charge: "Cobro", refund: "Reembolso", upcoming: "Próximo cobro", cancel: "Cancelación", failed: "Pago fallido", noise: "Sin interés" };
const SEVERITY_CHIP = { high: "chip chip-danger", medium: "chip chip-warn", low: "chip" };
const SEVERITY_LABEL = { high: "Importante", medium: "Aviso", low: "Info" };

function clock(ts) {
  if (!ts) return "—";
  const d = new Date(typeof ts === "number" ? ts * 1000 : ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function Toggle({ label, checked, onChange, disabled }) {
  return (
    <label className="flex items-center gap-2 text-[13px]">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function StatusCard({ status, source, onScan, onSettings, scanning, accounts }) {
  const s = status.settings;
  const run = status.last_run;
  const activeAccounts = accounts.filter((a) => !a.archived);
  const [interval, setInterval_] = useState(String(s.interval_min));
  useEffect(() => setInterval_(String(s.interval_min)), [s.interval_min]);
  const [above, setAbove] = useState(String(s.review_above));
  useEffect(() => setAbove(String(s.review_above)), [s.review_above]);
  const saveAbove = () => {
    const n = Number(String(above).replace(",", "."));
    if (Number.isFinite(n) && n >= 0 && n <= 1000000 && n !== s.review_above) onSettings({ review_above: n });
    else setAbove(String(s.review_above));
  };
  const saveInterval = () => {
    const n = Number(interval);
    if (Number.isInteger(n) && n >= 2 && n <= 1440 && n !== s.interval_min) onSettings({ interval_min: n });
    else setInterval_(String(s.interval_min));
  };
  const reachable = source?.ok;
  return (
    <Section
      title="Lectura del correo"
      aside={<button type="button" className="btn btn-primary" onClick={onScan} disabled={scanning || status.scanning || !s.enabled}>{scanning || status.scanning ? "Leyendo…" : "Leer ahora"}</button>}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <dl className="grid grid-cols-[150px_1fr] gap-y-2 text-[13px]">
          <dt className="help">Cuenta de correo</dt>
          <dd>
            {source == null && <span className="help">Comprobando…</span>}
            {source && reachable && <span>{(source.accounts || []).map((a) => a.user || a.account).filter(Boolean).join(", ") || "conectada"} <span className="chip chip-income ml-1">{source.source === "hub" ? "Hub" : "Faustus"}</span></span>}
            {source && !reachable && <span className="expense">{source.error || (source.source === "hub" ? "El hub no está disponible." : "Faustus no está disponible.")}</span>}
          </dd>
          <dt className="help">Leyendo de</dt>
          <dd>{source?.source === "hub" ? "la pasarela de correo del hub" : source?.source === "faustus" ? "el ayudante de Faustus" : <span className="help">…</span>}{source?.mode === "auto" && <span className="help"> (automático)</span>}</dd>
          <dt className="help">Última lectura</dt>
          <dd>
            {run ? <>{clock(run.ts)} {run.ok ? <span className="help">· {run.scanned} correos, {run.recorded} apuntados, {run.review} por revisar</span> : <span className="expense">· falló: {run.error}</span>}</> : <span className="help">Todavía no se ha leído nada.</span>}
          </dd>
          <dt className="help">Próxima lectura</dt>
          <dd>{!s.enabled ? <span className="help">Desactivada</span> : status.scheduler_running && status.next_scan_ts ? clock(status.next_scan_ts) : <span className="help">Sin programar (arranca con el servidor)</span>}</dd>
          <dt className="help">Cuenta de los cobros</dt>
          <dd>
            {status.account_problem ? <span className="expense">{status.account_problem}</span> : <span>{status.effective_account?.name}</span>}
          </dd>
        </dl>
        <div className="space-y-3">
          <Toggle label="Leer el correo automáticamente" checked={s.enabled} onChange={(v) => onSettings({ enabled: v })} />
          <Toggle label="Apuntar solos los cobros claros" checked={s.auto_record} onChange={(v) => onSettings({ auto_record: v })} />
          <Toggle label="Aviso de Windows" checked={s.toast} onChange={(v) => onSettings({ toast: v })} />
          <Toggle label="Avisar al resto de la familia Hoard" checked={s.hub} onChange={(v) => onSettings({ hub: v })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Origen del correo" help="Automático usa el hub si su pasarela está encendida y, si no, el ayudante de Faustus.">
              <select className="field field-sm" value={s.source || "auto"} onChange={(e) => onSettings({ source: e.target.value })}>
                <option value="auto">Automático</option>
                <option value="hub">El hub de la familia</option>
                <option value="faustus">Faustus</option>
              </select>
            </Field>
            <Field label="Cuenta para los cobros" help="Si hay una sola cuenta activa, se usa sin elegir.">
              <select className="field field-sm" value={s.account} onChange={(e) => onSettings({ account: e.target.value })}>
                <option value="">Automática</option>
                {activeAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            <Field label="Cada cuántos minutos">
              <input className="field field-sm num w-[110px]" inputMode="numeric" value={interval} onChange={(e) => setInterval_(e.target.value)} onBlur={saveInterval} onKeyDown={(e) => e.key === "Enter" && saveInterval()} />
            </Field>
            <Field label="Revisar a mano por encima de (€)" help="Los cobros mayores no se apuntan solos. 0 desactiva el límite.">
              <input className="field field-sm num w-[110px]" inputMode="decimal" value={above} onChange={(e) => setAbove(e.target.value)} onBlur={saveAbove} onKeyDown={(e) => e.key === "Enter" && saveAbove()} />
            </Field>
          </div>
        </div>
      </div>
    </Section>
  );
}

function ReviewItem({ item, accounts, categories, onAccept, onIgnore, onRemove, busy }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => ({
    account: "", category: "", amount: item.amount_cents != null ? centsToText(item.amount_cents) : "", date: item.date || "", merchant: item.merchant || "",
  }));
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const accept = () => {
    const overrides = {};
    for (const [k, v] of Object.entries(form)) if (String(v).trim()) overrides[k] = String(v).trim();
    onAccept(item, overrides);
  };
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold">
            {item.merchant || "Comercio sin identificar"} <span className="chip ml-1">{item.order_cancel ? "Pedido cancelado" : KIND_LABEL[item.kind] || item.kind}</span>
            {item.subscription && <span className="chip ml-1">Suscripción</span>}
          </div>
          <div className="help truncate text-[12px]" title={item.subject}>{item.subject}</div>
        </div>
        <div className="num text-[14px] font-semibold">{item.kind === "cancel" ? (item.entry?.amount || "—") : (item.amount || "—")} <span className="help text-[12px] font-normal">{(item.kind === "cancel" ? item.entry?.date : item.date) ? dateLabel(item.kind === "cancel" ? item.entry.date : item.date) : "sin fecha"}</span></div>
      </div>
      {item.review_reasons?.length > 0 && <p className="mt-1 text-[12px]" style={{ color: "var(--warn-ink)" }}>Por qué está aquí: {item.review_reasons.join(" · ")}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {item.kind === "cancel" ? (
          <>
            {item.cancels_message_id && <button type="button" className="btn btn-danger btn-sm" onClick={() => onRemove(item)} disabled={busy}>Quitar el movimiento</button>}
            <button type="button" className="btn btn-sm" onClick={() => onIgnore(item)} disabled={busy}>Dejarlo como está</button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => (open ? accept() : setOpen(true))} disabled={busy}>{open ? "Apuntar" : "Aceptar"}</button>
            {open && <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>Cerrar</button>}
            <button type="button" className="btn btn-sm" onClick={() => onIgnore(item)} disabled={busy}>Ignorar</button>
          </>
        )}
      </div>
      {open && item.kind !== "cancel" && (
        <div className="panel mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Comercio"><input className="field field-sm" value={form.merchant} onChange={set("merchant")} /></Field>
          <Field label="Importe"><input className="field field-sm num" inputMode="decimal" value={form.amount} onChange={set("amount")} placeholder="12,99" /></Field>
          <Field label="Fecha"><input type="date" className="field field-sm" value={form.date} onChange={set("date")} /></Field>
          <Field label="Cuenta">
            <select className="field field-sm" value={form.account} onChange={set("account")}>
              <option value="">La de los cobros</option>
              {accounts.filter((a) => !a.archived).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Categoría">
            <select className="field field-sm" value={form.category} onChange={set("category")}>
              <option value="">Automática</option>
              {categories.filter((c) => c.kind === "expense" && !c.archived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>
      )}
    </li>
  );
}

function PasteBox({ onPaste, busy }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ from: "", subject: "", text: "" });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    if (await onPaste(form)) { setForm({ from: "", subject: "", text: "" }); setOpen(false); }
  };
  if (!open) return <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>Pegar un recibo</button>;
  return (
    <form onSubmit={submit} className="panel grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Remitente (opcional)"><input className="field field-sm" value={form.from} onChange={set("from")} placeholder="Tienda <avisos@tienda.example>" /></Field>
        <Field label="Asunto"><input className="field field-sm" value={form.subject} onChange={set("subject")} placeholder="Recibo de tu pedido" /></Field>
      </div>
      <Field label="Texto del recibo" help="Sirve para recibos que no están en el buzón. Se procesa igual que un correo leído.">
        <textarea className="field" rows={5} value={form.text} onChange={set("text")} required />
      </Field>
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !form.text.trim()}>Procesar</button>
        <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
    </form>
  );
}

export default function Correo() {
  const { accounts, categories, refresh, notify } = useApp();
  const [month, setMonth] = useState(thisMonth());
  const [status, setStatus] = useState(null);
  const [source, setSource] = useState(null);
  const [review, setReview] = useState([]);
  const [recorded, setRecorded] = useState([]);
  const [duplicates, setDuplicates] = useState([]);
  const [notes, setNotes] = useState([]);
  const [undo, setUndo] = useState(null);
  const [run, busy] = useAction(notify);

  const load = useCallback(async () => {
    try {
      const [st, rv, rc, du, nt] = await Promise.all([
        api.mail.status(), api.mail.review(), api.mail.recorded(month), api.mail.messages({ state: "duplicate", limit: 20 }), api.mail.notifications(20),
      ]);
      setStatus(st); setReview(rv.messages); setRecorded(rc.messages); setDuplicates(du.messages); setNotes(nt.notifications);
    } catch (e) {
      notify({ kind: "error", text: e.message });
    }
  }, [month, notify]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let alive = true;
    api.mail.status({ source: true }).then((s) => alive && setSource(s.source || { ok: false })).catch((e) => alive && setSource({ ok: false, error: e.message }));
    return () => { alive = false; };
  }, []);
  // Keep the page fresh while a scan runs in the background.
  useEffect(() => {
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const after = async () => { await Promise.all([load(), refresh()]); };
  const settings = async (patch) => { const out = await run(() => api.mail.saveSettings(patch)); if (out) await load(); };
  const scan = async () => {
    const out = await run(() => api.mail.scan({}));
    if (!out) return;
    if (!out.ok) notify({ kind: "error", text: out.error || "La lectura ha fallado." });
    else notify({ kind: "ok", text: `Leídos ${out.scanned} correos: ${out.recorded} apuntados, ${out.review} por revisar, ${out.duplicates} duplicados.` });
    await after();
  };
  const accept = async (item, overrides) => { const out = await run(() => api.mail.accept({ message_id: item.message_id, ...overrides }), "Apuntado."); if (out) await after(); };
  const ignore = async (item) => { const out = await run(() => api.mail.ignore(item.message_id), "Ignorado."); if (out) await after(); };
  const confirmUndo = async () => {
    const item = undo;
    setUndo(null);
    const out = await run(() => api.mail.undo(item.cancels_message_id || item.message_id), "Movimiento borrado; el correo queda ignorado.");
    if (out) await after();
  };
  const paste = async (form) => {
    const out = await run(() => api.mail.paste({ ...form, from: form.from || "" }));
    if (!out) return false;
    notify({ kind: "ok", text: out.mail?.state === "recorded" ? "Recibo apuntado." : out.mail?.state === "review" ? "Recibo añadido a «Por revisar»." : "Recibo procesado." });
    await after();
    return true;
  };

  const accountOk = status && !status.account_problem;

  return (
    <Page
      title="Correo"
      description="Lee tu correo a través de Faustus, encuentra pagos y suscripciones y los apunta como gastos del mes. La contraseña nunca sale de Faustus."
      actions={<MonthPicker value={month} onChange={setMonth} />}
    >
      {!status ? <p className="help">Cargando…</p> : (
        <div className="space-y-4">
          <StatusCard status={status} source={source} onScan={scan} onSettings={settings} scanning={busy} accounts={accounts} />
          {status.account_problem && <p className="rounded-md border p-3 text-[13px]" style={{ background: "var(--warn-bg)", color: "var(--warn-ink)", borderColor: "var(--line)" }} role="status">{status.account_problem}</p>}

          <Section title={`Apuntado desde el correo en ${monthLabel(month)}`} aside={<span className="help num">{recorded.length} {recorded.length === 1 ? "movimiento" : "movimientos"}</span>}>
            {recorded.length ? (
              <table className="table">
                <thead><tr><th>Fecha</th><th>Comercio</th><th className="hidden sm:table-cell">Cuenta</th><th className="hidden sm:table-cell">Categoría</th><th className="r">Importe</th><th /></tr></thead>
                <tbody>
                  {recorded.map((m) => (
                    <tr key={m.message_id}>
                      <td className="num whitespace-nowrap">{dateLabel(m.entry?.date || m.date)}</td>
                      <td className="truncate" title={m.subject}>{m.entry?.counterparty || m.merchant}{m.matched_bank && <span className="chip chip-income ml-2">Conciliado con el banco</span>}</td>
                      <td className="hidden sm:table-cell">{m.entry?.account}</td>
                      <td className="hidden sm:table-cell">{m.entry?.category || <span className="help">—</span>}</td>
                      <td className={`r num whitespace-nowrap ${(m.entry?.amount_cents ?? 0) < 0 ? "expense" : "income"}`}>{m.entry?.amount || m.amount}</td>
                      <td className="whitespace-nowrap">
                        <a className="btn btn-sm" href={`#/movimientos?text=${encodeURIComponent(m.entry?.counterparty || m.merchant || "")}&from=${month}-01`}>Ver</a>
                        <button type="button" className="btn btn-danger btn-sm ml-1" onClick={() => setUndo(m)} disabled={m.matched_bank} title={m.matched_bank ? "Ya lo concilió un extracto del banco: bórralo desde Movimientos." : "Borrar el movimiento"}>Deshacer</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty text={accountOk ? "Nada apuntado desde el correo este mes. «Leer ahora» busca recibos y cobros recientes." : "Elige una cuenta para los cobros y vuelve a leer el correo."} />
            )}
          </Section>

          <Section title="Por revisar" aside={<span className="help num">{review.length}</span>}>
            {review.length ? (
              <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
                {review.map((m) => <ReviewItem key={m.message_id} item={m} accounts={accounts} categories={categories} onAccept={accept} onIgnore={ignore} onRemove={setUndo} busy={busy} />)}
              </ul>
            ) : <p className="help">No hay correos pendientes de revisar.</p>}
            <div className="mt-4"><PasteBox onPaste={paste} busy={busy} /></div>
          </Section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Duplicados vistos" aside={<span className="help num">{duplicates.length}</span>}>
              {duplicates.length ? (
                <ul className="divide-y text-[13px]" style={{ borderColor: "var(--line)" }}>
                  {duplicates.map((m) => (
                    <li key={m.message_id} className="flex items-baseline justify-between gap-2 py-2">
                      <span className="truncate" title={m.subject}>{m.merchant || m.subject}</span>
                      <span className="help num whitespace-nowrap">{m.amount || "—"} · {m.date ? dateLabel(m.date) : ""}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="help">Ningún correo coincidió con movimientos que ya tenías. Si pasa, se enlaza y no se cuenta dos veces.</p>}
            </Section>
            <Section title="Avisos recientes" aside={<span className="help num">{notes.length}</span>}>
              {notes.length ? (
                <ul className="divide-y text-[13px]" style={{ borderColor: "var(--line)" }}>
                  {notes.map((n) => (
                    <li key={n.id} className="py-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <span><span className={SEVERITY_CHIP[n.severity] || "chip"}>{SEVERITY_LABEL[n.severity] || n.severity}</span> <span className="ml-1 font-semibold">{n.title}</span></span>
                        <span className="help whitespace-nowrap text-[11px]">{clock(n.ts)}</span>
                      </div>
                      {n.body && <div className="help text-[12px]">{n.body}</div>}
                    </li>
                  ))}
                </ul>
              ) : <p className="help">Sin avisos todavía.</p>}
            </Section>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={!!undo}
        title="¿Deshacer este apunte?"
        text={undo ? `Se borrará el movimiento de ${undo.entry?.counterparty || undo.merchant} (${undo.entry?.amount || undo.amount}) y el correo quedará ignorado.` : ""}
        confirmLabel="Deshacer"
        onConfirm={confirmUndo}
        onCancel={() => setUndo(null)}
      />
    </Page>
  );
}
