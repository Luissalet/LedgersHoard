import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { Page, Section, Field, Empty, useAction } from "../components/ui.jsx";
import { formatCents, dateLabel } from "../format.js";

const FIELDS = [
  ["date", "Fecha"],
  ["amount", "Importe (con signo)"],
  ["debit", "Cargo / Debe"],
  ["credit", "Abono / Haber"],
  ["description", "Concepto"],
  ["counterparty", "Contraparte"],
];

export default function Importar() {
  const { accounts, categories, settings, refresh, notify } = useApp();
  const symbol = settings?.currency_symbol || "€";
  const active = accounts.filter((a) => !a.archived);
  const [csv, setCsv] = useState("");
  const [filename, setFilename] = useState("");
  const [accountId, setAccountId] = useState(active[0]?.id || "");
  const [categoryId, setCategoryId] = useState("");
  const [mapping, setMapping] = useState({});
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [run, busy] = useAction(notify);

  useEffect(() => { api.imports.list().then(setHistory).catch(() => {}); }, [result]);

  const doPreview = async (overrides = {}) => {
    if (!csv.trim()) return notify({ kind: "error", text: "Pega el CSV o elige un archivo." });
    const next = { ...mapping, ...overrides };
    const out = await run(() => api.imports.preview({ csv, mapping: next, account_id: accountId }));
    if (out) { setPreview(out); setMapping(out.mapping); setResult(null); }
  };

  const setMap = (field) => async (e) => {
    const value = e.target.value;
    const next = { ...mapping, [field]: value };
    if (field === "amount" && value) { next.debit = ""; next.credit = ""; }
    if ((field === "debit" || field === "credit") && value) next.amount = "";
    setMapping(next);
    await doPreview(next);
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    setCsv(await file.text());
    setPreview(null);
  };

  const commit = async () => {
    if (!accountId) return notify({ kind: "error", text: "Elige la cuenta de destino." });
    const out = await run(() => api.imports.commit({ csv, mapping, account_id: accountId, filename, category_id: categoryId || null }), "Importación completada.");
    if (out) { setResult(out); setPreview(null); refresh(); }
  };

  return (
    <Page title="Importar extracto" description="Pega el CSV del banco o elige el archivo. Se detectan separador, cabecera, fechas y decimales; ajusta el mapeo si hace falta. Las filas ya importadas se omiten.">
      {!active.length ? (
        <Empty text="Necesitas una cuenta a la que importar." action={<a href="#/cuentas" className="btn btn-primary">Crear cuenta</a>} />
      ) : (
        <div className="grid gap-4">
          <Section title="1. Archivo">
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr]">
              <Field label="Archivo CSV"><input type="file" accept=".csv,.txt,text/csv" className="field" onChange={onFile} /></Field>
              <Field label="Cuenta de destino">
                <select className="field" value={accountId} onChange={(e) => { setAccountId(e.target.value); setPreview(null); }}>
                  {active.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
              <Field label="Categoría por defecto" help="Opcional; puedes recategorizar después.">
                <select className="field" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  <option value="">Sin categoría</option>
                  {categories.filter((c) => !c.archived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
            </div>
            <Field label="O pega el texto" className="mt-3">
              <textarea className="field font-mono text-[12px]" rows={6} value={csv} onChange={(e) => { setCsv(e.target.value); setPreview(null); }} placeholder={"Fecha;Concepto;Importe\n03/09/2026;SUPERMERCADO EJEMPLO;-42,10"} />
            </Field>
            <div className="mt-3"><button type="button" className="btn btn-primary" onClick={() => doPreview()} disabled={busy || !csv.trim()}>Analizar</button></div>
          </Section>

          {preview && (
            <Section title="2. Mapeo y vista previa" aside={<span className="help">separador «{preview.delimiter === "\t" ? "tab" : preview.delimiter}» · {preview.hasHeader ? "con cabecera" : "sin cabecera"}</span>}>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
                {FIELDS.map(([key, label]) => (
                  <Field key={key} label={label}>
                    <select className="field field-sm" value={mapping[key] || ""} onChange={setMap(key)}>
                      <option value="">—</option>
                      {preview.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </Field>
                ))}
                <Field label="Decimal">
                  <select className="field field-sm" value={mapping.decimal || ","} onChange={setMap("decimal")}>
                    <option value=",">coma (12,50)</option>
                    <option value=".">punto (12.50)</option>
                  </select>
                </Field>
              </div>
              <label className="mt-2 inline-flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={!!mapping.invert} onChange={(e) => { const next = { ...mapping, invert: e.target.checked }; setMapping(next); doPreview(next); }} />
                Invertir signo (el banco muestra los gastos en positivo)
              </label>
              <div className="mt-4 flex flex-wrap gap-2 text-[13px]">
                <span className="chip">{preview.rows_total} filas</span>
                <span className="chip chip-income">{preview.rows_new} nuevas</span>
                <span className="chip chip-warn">{preview.rows_duplicate} duplicadas</span>
                {preview.rows_invalid > 0 && <span className="chip chip-danger">{preview.rows_invalid} no reconocidas</span>}
              </div>
              <div className="-mx-2 mt-3 overflow-x-auto">
                <table className="table min-w-[600px]">
                  <thead><tr><th>#</th><th>Fecha</th><th className="r">Importe</th><th>Concepto</th><th>Contraparte</th><th>Estado</th></tr></thead>
                  <tbody>
                    {preview.sample.map((r) => (
                      <tr key={r.row} style={r.error ? { color: "var(--danger-ink)" } : r.duplicate ? { opacity: 0.55 } : undefined}>
                        <td className="num">{r.row}</td>
                        <td className="num">{r.date ? dateLabel(r.date) : "?"}</td>
                        <td className={`r num ${r.amount_cents < 0 ? "expense" : "income"}`}>{r.amount_cents != null ? formatCents(r.amount_cents, symbol) : "?"}</td>
                        <td className="max-w-[260px] truncate" title={r.description}>{r.description}</td>
                        <td className="max-w-[180px] truncate">{r.counterparty !== r.description ? r.counterparty : ""}</td>
                        <td>{r.error ? <span className="chip chip-danger">{r.error}</span> : r.duplicate ? <span className="chip chip-warn">Duplicada</span> : <span className="chip chip-income">Nueva</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.rows_total > 20 && <p className="help mt-2">Se muestran las 20 primeras filas.</p>}
              </div>
              <div className="mt-4 flex items-center gap-3">
                <button type="button" className="btn btn-primary" onClick={commit} disabled={busy || preview.rows_new === 0}>Importar {preview.rows_new} movimientos</button>
                {preview.rows_new === 0 && <span className="help">Nada nuevo que importar.</span>}
              </div>
            </Section>
          )}

          {result && (
            <Section title="3. Resultado">
              <p className="text-[13px]">Añadidos <strong>{result.rows_added}</strong> · omitidos por duplicado <strong>{result.rows_skipped}</strong>{result.rows_invalid > 0 && <> · no reconocidos <strong>{result.rows_invalid}</strong></>}.</p>
              <a href="#/movimientos" className="btn mt-3">Ver movimientos</a>
            </Section>
          )}

          {history.length > 0 && (
            <Section title="Importaciones anteriores">
              <table className="table">
                <thead><tr><th>Fecha</th><th>Archivo</th><th className="r">Filas</th><th className="r">Añadidas</th><th className="r">Omitidas</th></tr></thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id}><td className="num">{h.created_at.slice(0, 16).replace("T", " ")}</td><td>{h.filename || <span className="help">(pegado)</span>}</td><td className="r num">{h.rows_total}</td><td className="r num">{h.rows_added}</td><td className="r num">{h.rows_skipped}</td></tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}
        </div>
      )}
    </Page>
  );
}
