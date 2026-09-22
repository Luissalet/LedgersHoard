import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, tabulate, guessMapping, mapRows, detectDelimiter } from "../server/csv.js";
import { parseDate } from "../server/dates.js";
import { SAMPLE_CSV } from "./helpers.js";

test("parseDate accepts the common Spanish and ISO formats", () => {
  assert.equal(parseDate("2026-09-03"), "2026-09-03");
  assert.equal(parseDate("03/09/2026"), "2026-09-03");
  assert.equal(parseDate("03-09-2026"), "2026-09-03");
  assert.equal(parseDate("3.9.2026"), "2026-09-03");
  assert.equal(parseDate("03/09/26"), "2026-09-03");
  assert.equal(parseDate("2026/09/03"), "2026-09-03");
  assert.equal(parseDate("2026-09-03T10:00:00Z"), "2026-09-03");
  assert.equal(parseDate("31/02/2026"), null);
  assert.equal(parseDate("hola"), null);
  assert.equal(parseDate("12,50"), null);
});

test("detects ; , and tab delimiters and quoted fields", () => {
  assert.equal(detectDelimiter(SAMPLE_CSV), ";");
  assert.equal(detectDelimiter('Date,Description,Amount\n2026-09-01,"Coffee, big",-2.50\n'), ",");
  assert.equal(detectDelimiter("Date\tAmount\n2026-09-01\t-2.50\n"), "\t");
  const { rows } = parseCsv(SAMPLE_CSV);
  assert.equal(rows.length, 4);
  assert.equal(rows[3][1], 'RECIBO LUZ "HOGAR" SEPTIEMBRE');
  const comma = parseCsv('a,b\n"x, y","line\nbreak"\n');
  assert.deepEqual(comma.rows[1], ["x, y", "line\nbreak"]);
});

test("header detection and mapping guess (single amount column)", () => {
  const table = tabulate(SAMPLE_CSV);
  assert.equal(table.hasHeader, true);
  assert.deepEqual(table.columns, ["Fecha", "Concepto", "Importe", "Saldo"]);
  const mapping = guessMapping(table.columns, table.data);
  assert.equal(mapping.date, "Fecha");
  assert.equal(mapping.amount, "Importe");
  assert.equal(mapping.description, "Concepto");
  assert.equal(mapping.decimal, ",");
  const rows = mapRows(table.columns, table.data, mapping);
  assert.deepEqual(rows.map((r) => r.amount_cents), [-4210, 150000, -6325]);
  assert.deepEqual(rows.map((r) => r.date), ["2026-09-03", "2026-09-05", "2026-09-07"]);
  assert.equal(rows[2].counterparty, 'RECIBO LUZ "HOGAR" SEPTIEMBRE');
  assert.ok(rows.every((r) => !r.error));
});

test("mapping guess with debit/credit columns and English decimals", () => {
  const csv = "Date,Payee,Memo,Debit,Credit\n2026-09-01,Grocery Example,weekly,42.10,\n2026-09-02,Employer Example,salary,,1500.00\n";
  const table = tabulate(csv);
  const mapping = guessMapping(table.columns, table.data);
  assert.equal(mapping.debit, "Debit");
  assert.equal(mapping.credit, "Credit");
  assert.equal(mapping.amount, undefined);
  assert.equal(mapping.counterparty, "Payee");
  assert.equal(mapping.description, "Memo");
  assert.equal(mapping.decimal, ".");
  const rows = mapRows(table.columns, table.data, mapping);
  assert.deepEqual(rows.map((r) => r.amount_cents), [-4210, 150000]);
  assert.equal(rows[0].counterparty, "Grocery Example");
  assert.equal(rows[0].note, "weekly");
});

test("headerless CSV guesses by content and reports bad rows", () => {
  const csv = "01/09/2026;PANADERIA EJEMPLO;-3,20\n02/09/2026;;abc\n;OTRA COSA;-1,00\n";
  const table = tabulate(csv);
  assert.equal(table.hasHeader, false);
  assert.deepEqual(table.columns, ["Columna 1", "Columna 2", "Columna 3"]);
  const mapping = guessMapping(table.columns, table.data);
  assert.equal(mapping.date, "Columna 1");
  assert.equal(mapping.amount, "Columna 3");
  assert.equal(mapping.description, "Columna 2");
  const rows = mapRows(table.columns, table.data, mapping);
  assert.equal(rows[0].error, null);
  assert.equal(rows[1].error, "Importe no reconocido");
  assert.equal(rows[2].error, "Fecha no reconocida");
  assert.deepEqual(mapRows(table.columns, table.data, { ...mapping, invert: true })[0].amount_cents, 320);
});
