import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAmount, formatCents, detectColumnDecimal } from "../shared/money.js";

test("parseAmount handles Spanish and English formats", () => {
  const cases = [
    ["12,50", 1250], ["12.5", 1250], ["-3", -300], ["1.234,56", 123456], ["1,234.56", 123456],
    ["12,5", 1250], ["0,99", 99], ["1.234", 123400], ["1,234", 123400], ["12.500", 1250000],
    ["1.234.567,89", 123456789], ["1,234,567.89", 123456789], ["0.500", 50], ["100", 10000],
    ["12,50 €", 1250], ["€ 12,50", 1250], ["12.50 EUR", 1250], ["-12,50€", -1250],
    ["(12,00)", -1200], ["12,00-", -1200], ["+7,5", 750], ["−3,10", -310], [" 1 234,56 ", 123456],
    ["12,5051", 1251], ["12,5049", 1250], [12.5, 1250], [-3, -300], ["0", 0], ["0,00", 0],
  ];
  for (const [input, expected] of cases) assert.equal(parseAmount(input), expected, `parseAmount(${JSON.stringify(input)})`);
});

test("parseAmount rejects garbage", () => {
  for (const bad of ["", "abc", "12,50,3", "1.2.3,4,5", "1.23.456", "1234.567,00", "--3", null, undefined, {}, NaN, Infinity, "12,3.4,5"])
    assert.equal(parseAmount(bad), null, `parseAmount(${JSON.stringify(bad)})`);
});

test("parseAmount honours a forced decimal separator", () => {
  assert.equal(parseAmount("1.234", { decimal: "." }), 123);
  assert.equal(parseAmount("12,505", { decimal: "," }), 1251);
  assert.equal(parseAmount("1,234", { decimal: "," }), 123);
  assert.equal(parseAmount("12.500", { decimal: "." }), 1250);
  assert.equal(parseAmount("1,234.56", { decimal: "." }), 123456);
});

test("detectColumnDecimal looks at the whole column", () => {
  assert.equal(detectColumnDecimal(["-42,10", "1.500,00", "12"]), ",");
  assert.equal(detectColumnDecimal(["-42.10", "1,500.00", "12"]), ".");
  assert.equal(detectColumnDecimal(["12", "100"]), null);
});

test("formatCents renders Spanish currency text", () => {
  assert.equal(formatCents(1250), "12,50 €");
  assert.equal(formatCents(-1250), "-12,50 €");
  assert.equal(formatCents(123456789), "1.234.567,89 €");
  assert.equal(formatCents(5), "0,05 €");
  assert.equal(formatCents(0), "0,00 €");
  assert.equal(formatCents(1250, ""), "12,50");
  assert.equal(formatCents(1250, "USD"), "12,50 USD");
});
