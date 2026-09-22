// CSV parsing for bank statements: delimiter detection (; , tab), quoted
// fields, header detection and a column mapping guess.
import { parseAmount, detectColumnDecimal } from "./money.js";
import { parseDate } from "./dates.js";

export const DELIMITERS = [";", ",", "\t", "|"];

export function detectDelimiter(text) {
  const sample = splitRecords(text).slice(0, 10);
  let best = ";";
  let bestScore = -1;
  for (const d of DELIMITERS) {
    const counts = sample.map((line) => splitLine(line, d).length - 1);
    const min = Math.min(...counts);
    const consistent = counts.every((c) => c === counts[0]);
    const score = min * (consistent ? 2 : 1);
    if (min > 0 && score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

/** Split a single line honouring double quotes ("" escapes a quote). */
function splitLine(line, delimiter) {
  const out = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { out.push(field); field = ""; }
    else field += ch;
  }
  out.push(field);
  return out.map((f) => f.trim());
}

/** Split text into records, honouring newlines inside quoted fields. */
function splitRecords(text) {
  const records = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    if (!quoted && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      if (current.trim()) records.push(current);
      current = "";
    } else current += ch;
  }
  if (current.trim()) records.push(current);
  return records;
}

export function parseCsv(text, delimiter = null) {
  const clean = String(text || "").replace(/^\uFEFF/, "");
  const d = delimiter && DELIMITERS.includes(delimiter) ? delimiter : detectDelimiter(clean);
  const rows = splitRecords(clean).map((line) => splitLine(line, d));
  const width = Math.max(0, ...rows.map((r) => r.length));
  return { delimiter: d, rows: rows.map((r) => [...r, ...Array(width - r.length).fill("")]), width };
}

function looksLikeHeader(row) {
  if (!row.length) return false;
  const hasDate = row.some((c) => parseDate(c));
  const hasNumber = row.some((c) => /^[-+(]?[\d.,]+\)?$/.test(c) && parseAmount(c) !== null);
  const hasLetters = row.some((c) => /[A-Za-zÁÉÍÓÚáéíóúñÑ]/.test(c));
  return hasLetters && !hasDate && !hasNumber;
}

const HEADER_PATTERNS = {
  date: /fecha|date|f\.?\s*(valor|oper)|día|dia/i,
  amount: /^importe|^amount|^cantidad|^monto|^valor$|^total/i,
  debit: /cargo|debe|d[ée]bito|debit|gasto|salida|retirada|withdrawal/i,
  credit: /abono|haber|cr[ée]dito|credit|ingreso|entrada|dep[oó]sito|deposit/i,
  description: /concepto|descripci|description|detalle|memo|observ|texto/i,
  counterparty: /beneficiario|contraparte|payee|comercio|ordenante|merchant|tercero|nombre|emisor|receptor/i,
};

/** Table = parsed rows split into headers + data with column names. */
export function tabulate(text, options = {}) {
  const { delimiter, rows, width } = parseCsv(text, options.delimiter);
  const header = options.hasHeader ?? (rows.length > 0 && looksLikeHeader(rows[0]));
  const columns = Array.from({ length: width }, (_, i) => {
    const name = header ? rows[0][i]?.trim() : "";
    return name || `Columna ${i + 1}`;
  });
  // Deduplicate column names so a mapping by name is unambiguous.
  const seen = new Map();
  for (let i = 0; i < columns.length; i++) {
    const n = seen.get(columns[i]) || 0;
    seen.set(columns[i], n + 1);
    if (n > 0) columns[i] = `${columns[i]} (${n + 1})`;
  }
  const data = header ? rows.slice(1) : rows;
  return { delimiter, hasHeader: header, columns, data };
}

/** Guess which column holds each field. Values in the result are column names. */
export function guessMapping(columns, data) {
  const guess = {};
  const taken = new Set();
  const pick = (field, pattern) => {
    const idx = columns.findIndex((c, i) => !taken.has(i) && pattern.test(c));
    if (idx >= 0) { guess[field] = columns[idx]; taken.add(idx); }
  };
  pick("date", HEADER_PATTERNS.date);
  pick("debit", HEADER_PATTERNS.debit);
  pick("credit", HEADER_PATTERNS.credit);
  if (!(guess.debit && guess.credit)) {
    delete guess.debit; delete guess.credit;
    taken.clear(); if (guess.date) taken.add(columns.indexOf(guess.date));
    pick("amount", HEADER_PATTERNS.amount);
  }
  pick("counterparty", HEADER_PATTERNS.counterparty);
  pick("description", HEADER_PATTERNS.description);

  const sample = data.slice(0, 30);
  const colValues = (i) => sample.map((r) => r[i] ?? "");
  const share = (i, test) => (sample.length ? colValues(i).filter(test).length / sample.length : 0);
  if (!guess.date) {
    const idx = columns.findIndex((_, i) => !taken.has(i) && share(i, (v) => !!parseDate(v)) >= 0.6);
    if (idx >= 0) { guess.date = columns[idx]; taken.add(idx); }
  }
  if (!guess.amount && !(guess.debit && guess.credit)) {
    const numeric = columns
      .map((_, i) => i)
      .filter((i) => !taken.has(i) && share(i, (v) => v !== "" && parseAmount(v) !== null && !parseDate(v)) >= 0.6);
    // Prefer the column with signed values (income and expense) — a balance column rarely changes sign.
    const withSign = numeric.filter((i) => colValues(i).some((v) => /^-|-$|^\(/.test(v.trim())));
    const idx = withSign[0] ?? numeric[0];
    if (idx != null) { guess.amount = columns[idx]; taken.add(idx); }
  }
  if (!guess.description) {
    const idx = columns.findIndex((_, i) => !taken.has(i) && share(i, (v) => /[A-Za-zÁÉÍÓÚáéíóúñÑ]{3,}/.test(v)) >= 0.6);
    if (idx >= 0) { guess.description = columns[idx]; taken.add(idx); }
  }
  const amountCols = [guess.amount, guess.debit, guess.credit].filter(Boolean).map((n) => columns.indexOf(n));
  guess.decimal = detectColumnDecimal(amountCols.flatMap((i) => colValues(i))) || ",";
  return guess;
}

/**
 * Turn data rows into candidate entries using a mapping (column names).
 * Each result: { row, date, amount_cents, description, counterparty, error }.
 */
export function mapRows(columns, data, mapping) {
  const col = (name) => (name ? columns.indexOf(name) : -1);
  const iDate = col(mapping.date), iAmount = col(mapping.amount), iDebit = col(mapping.debit);
  const iCredit = col(mapping.credit), iDesc = col(mapping.description), iParty = col(mapping.counterparty);
  const decimal = mapping.decimal === "." ? "." : ",";
  const cell = (r, i) => (i >= 0 ? String(r[i] ?? "").trim() : "");
  return data.map((r, index) => {
    const date = parseDate(cell(r, iDate));
    let amount_cents = null;
    if (iAmount >= 0) amount_cents = parseAmount(cell(r, iAmount), { decimal });
    else if (iDebit >= 0 || iCredit >= 0) {
      const debit = parseAmount(cell(r, iDebit), { decimal });
      const credit = parseAmount(cell(r, iCredit), { decimal });
      if (debit !== null || credit !== null) amount_cents = Math.abs(credit || 0) - Math.abs(debit || 0);
    }
    if (mapping.invert && amount_cents !== null) amount_cents = -amount_cents;
    const description = cell(r, iDesc);
    const counterparty = cell(r, iParty) || description;
    let error = null;
    if (!date) error = "Fecha no reconocida";
    else if (amount_cents === null) error = "Importe no reconocido";
    else if (amount_cents === 0) error = "Importe cero";
    return { row: index + 1, date, amount_cents, description, counterparty, note: iParty >= 0 ? description : "", error };
  });
}
