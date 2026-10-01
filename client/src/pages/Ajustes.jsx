import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { Page, Section, Field, ConfirmDialog, useAction } from "../components/ui.jsx";

function MailSettings({ notify }) {
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(null);
  const [resetting, setResetting] = useState(false);
  const [withEntries, setWithEntries] = useState(false);
  const [run, busy] = useAction(notify);
  useEffect(() => {
    api.mail.settings().then((s) => { const f = { faustus_dir: s.faustus_dir || "", faustus_owner: s.faustus_owner || "" }; setForm(f); setSaved(f); }).catch(() => setForm(null));
  }, []);
  if (!form) return null;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    if (form.faustus_dir === saved.faustus_dir && form.faustus_owner === saved.faustus_owner) return;
    const out = await run(() => api.mail.saveSettings(form), "Ajustes del correo guardados.");
    if (out) setSaved(form);
  };
  return (
    <Section title="Correo (Faustus)">
      <div className="space-y-3">
        <Field label="Carpeta de Faustus" help="Vacía: se busca en LEDGER_FAUSTUS_DIR, FAUSTUS_DIR y las carpetas «faustus» vecinas. Debe contener mcp_servers/email_server.py.">
          <input className="field" value={form.faustus_dir} onChange={set("faustus_dir")} onBlur={save} placeholder="C:\Faustus" disabled={busy} />
        </Field>
        <Field label="Usuario de Faustus" help="Solo si hay varios usuarios con cuenta de correo.">
          <input className="field w-[240px]" value={form.faustus_owner} onChange={set("faustus_owner")} onBlur={save} disabled={busy} />
        </Field>
      </div>
      <p className="help mt-3">El resto (cuenta de los cobros, frecuencia, límite de importe, avisos) está en la página <a href="#/correo" className="btn-link">Correo</a>.</p>
      <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--line)" }}>
        <div className="label">Empezar de cero</div>
        <p className="help mb-2">Olvida los correos leídos, las suscripciones creadas desde el correo, los avisos y el historial de lecturas. Los movimientos no se tocan salvo que lo marques.</p>
        <button type="button" className="btn btn-danger btn-sm" onClick={() => setResetting(true)} disabled={busy}>Reiniciar el correo…</button>
      </div>
      <ConfirmDialog
        open={resetting}
        title="¿Reiniciar el correo?"
        text={<span>Se borra el registro de correos leídos, las suscripciones del correo y los avisos. La próxima lectura vuelve a mirar los últimos meses.<label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={withEntries} onChange={(e) => setWithEntries(e.target.checked)} /> Borrar también los movimientos que apuntó el correo (los que ya concilió el banco se quedan)</label></span>}
        confirmLabel="Reiniciar"
        onCancel={() => setResetting(false)}
        onConfirm={async () => {
          setResetting(false);
          const out = await run(() => api.mail.reset({ delete_entries: withEntries }));
          if (out) notify({ kind: "ok", text: `Reiniciado: ${out.mail_messages} correos, ${out.subscriptions} suscripciones${out.entries_deleted ? `, ${out.entries_deleted} movimientos` : ""}.` });
          setWithEntries(false);
        }}
      />
    </Section>
  );
}

export default function Ajustes() {
  const { settings, dataDir, version, refresh, notify } = useApp();
  const [symbol, setSymbol] = useState(settings?.currency_symbol || "€");
  const [run, busy] = useAction(notify);
  const save = async () => {
    const out = await run(() => api.settings({ currency_symbol: symbol.trim() || "€" }), "Ajustes guardados.");
    if (out) refresh();
  };
  return (
    <Page title="Ajustes" description="Preferencias de presentación y datos de la instalación.">
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Moneda">
          <Field label="Símbolo" help="Se muestra junto a los importes; cada cuenta guarda su propia divisa.">
            <input className="field w-[120px]" value={symbol} maxLength={5} onChange={(e) => setSymbol(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && save()} disabled={busy} />
          </Field>
        </Section>
        <MailSettings notify={notify} />
        <Section title="Instalación">
          <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-[13px]">
            <dt className="help">Versión</dt><dd>{version}</dd>
            <dt className="help">Carpeta de datos</dt><dd className="break-all font-mono text-[12px]">{dataDir}</dd>
            <dt className="help">Base de datos</dt><dd className="font-mono text-[12px]">ledgers-hoard.db (SQLite, WAL)</dd>
            <dt className="help">Puente MCP</dt><dd className="font-mono text-[12px]">server/mcp.js · token en {"<datos>"}/mcp-token</dd>
          </dl>
          <p className="help mt-3">Para cambiar la carpeta, arranca la aplicación con la variable de entorno <code>LEDGER_DATA_DIR</code>. El asistente se conecta con <code>npm run mcp</code> o mediante el manifiesto <code>faustus-plugin.json</code>.</p>
        </Section>
      </div>
    </Page>
  );
}
