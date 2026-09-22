import React, { useState } from "react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { Page, Section, Field, useAction } from "../components/ui.jsx";

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
