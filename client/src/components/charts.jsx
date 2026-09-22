import React, { useState } from "react";
import { formatCents, monthShort } from "../format.js";

// Two-series palette validated for colour-vision deficiency on a white surface.
export const SERIES = { income: "#2a6f9e", expense: "#b3762a" };

function niceMax(value) {
  if (value <= 0) return 100;
  const pow = 10 ** Math.floor(Math.log10(value));
  const n = value / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

/** Grouped bars: income vs expense per month. Pure SVG, hover tooltip, legend. */
export function MonthsChart({ months, symbol }) {
  const [hover, setHover] = useState(null);
  const width = 720, height = 260, left = 56, right = 12, top = 16, bottom = 34;
  const plotW = width - left - right, plotH = height - top - bottom;
  const max = niceMax(Math.max(...months.map((m) => Math.max(m.income, m.expense)), 1));
  const group = plotW / Math.max(months.length, 1);
  const barW = Math.max(4, Math.min(22, (group - 10) / 2 - 1));
  const y = (v) => top + plotH - (v / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const fmtAxis = (v) => String(Math.round(v / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (
    <figure className="m-0">
      <div className="mb-2 flex gap-4 text-[12px]" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SERIES.income }} />Ingresos</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SERIES.expense }} />Gastos</span>
      </div>
      <div className="relative overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[520px]" role="img" aria-label="Ingresos y gastos por mes" onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={width - right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
              <text x={left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--supporting-ink)" className="num">{fmtAxis(t)}</text>
            </g>
          ))}
          {months.map((m, i) => {
            const cx = left + group * i + group / 2;
            const active = hover === i;
            return (
              <g key={m.month} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${monthShort(m.month)}: ingresos ${formatCents(m.income, symbol)}, gastos ${formatCents(m.expense, symbol)}`}>
                <rect x={left + group * i} y={top} width={group} height={plotH} fill={active ? "var(--soft)" : "transparent"} />
                <rect x={cx - barW - 1} y={y(m.income)} width={barW} height={Math.max(0, y(0) - y(m.income))} fill={SERIES.income} rx="2" />
                <rect x={cx + 1} y={y(m.expense)} width={barW} height={Math.max(0, y(0) - y(m.expense))} fill={SERIES.expense} rx="2" />
                <text x={cx} y={height - 12} textAnchor="middle" fontSize="11" fill="var(--supporting-ink)">{monthShort(m.month)}</text>
              </g>
            );
          })}
          <line x1={left} x2={width - right} y1={y(0)} y2={y(0)} stroke="var(--field-line)" strokeWidth="1" />
        </svg>
        {hover != null && months[hover] && (
          <div className="pointer-events-none absolute top-2 rounded-md border px-3 py-2 text-[12px] shadow-sm" style={{ left: `${Math.min(80, ((hover + 0.5) / months.length) * 100)}%`, background: "var(--white)", borderColor: "var(--line)" }}>
            <div className="font-semibold">{monthShort(months[hover].month)}</div>
            <div className="num">Ingresos {formatCents(months[hover].income, symbol)}</div>
            <div className="num">Gastos {formatCents(months[hover].expense, symbol)}</div>
            <div className={`num ${months[hover].net < 0 ? "expense" : "income"}`}>Neto {formatCents(months[hover].net, symbol)}</div>
          </div>
        )}
      </div>
    </figure>
  );
}

/** Donut of expense by category (top 8 + "Otras"), with a labelled list beside it. */
export function CategoryDonut({ lines, symbol }) {
  const [hover, setHover] = useState(null);
  const sorted = [...lines].filter((l) => l.spent > 0).sort((a, b) => b.spent - a.spent);
  const top = sorted.slice(0, 8);
  const rest = sorted.slice(8);
  if (rest.length) top.push({ id: "rest", name: "Otras", spent: rest.reduce((s, l) => s + l.spent, 0), color: "#9a9083" });
  const total = top.reduce((s, l) => s + l.spent, 0);
  if (!total) return <p className="help">Sin gastos en este mes.</p>;
  const r = 70, cx = 90, cy = 90, stroke = 22, circumference = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 180 180" width="180" height="180" role="img" aria-label="Reparto del gasto por categoría" onMouseLeave={() => setHover(null)}>
        {top.map((l, i) => {
          const len = (l.spent / total) * circumference;
          const dash = `${Math.max(0, len - 2)} ${circumference - Math.max(0, len - 2) + 2}`;
          const el = (
            <circle key={l.id || i} r={r} cx={cx} cy={cy} fill="none" stroke={l.color || "var(--accent)"} strokeWidth={hover === i ? stroke + 4 : stroke}
              strokeDasharray={dash} strokeDashoffset={-offset} transform={`rotate(-90 ${cx} ${cy})`} onMouseEnter={() => setHover(i)}>
              <title>{`${l.name}: ${formatCents(l.spent, symbol)} (${Math.round((l.spent / total) * 100)}%)`}</title>
            </circle>
          );
          offset += len;
          return el;
        })}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="11" fill="var(--supporting-ink)">{hover != null ? top[hover].name : "Total"}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--ink)" className="num">{formatCents(hover != null ? top[hover].spent : total, symbol)}</text>
      </svg>
      <ul className="min-w-[220px] flex-1 space-y-1 text-[13px]">
        {top.map((l, i) => (
          <li key={l.id || i} className="flex items-center justify-between gap-3" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span className="inline-flex items-center gap-2"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: l.color || "var(--accent)" }} />{l.name}</span>
            <span className="num"><span className="help mr-2">{Math.round((l.spent / total) * 100)}%</span>{formatCents(l.spent, symbol)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
