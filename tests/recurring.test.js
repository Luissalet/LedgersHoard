import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "./helpers.js";

let s;
before(async () => { s = await bootServer(); });
after(async () => { await s.stop(); });

test("finds sourced monthly payments and a price rise without changing entries", async () => {
  const account = (await s.agent("upsert_account", { name: "Banco prueba" })).body.account;
  for (let month = 3; month <= 8; month++) {
    const mm = String(month).padStart(2, "0");
    await s.call("POST", "/api/entries", { date: `2026-${mm}-05`, amount_cents: month === 8 ? -1299 : -999, account_id: account.id, counterparty: "Nétflix" });
    await s.call("POST", "/api/entries", { date: `2026-${mm}-09`, amount_cents: -4000 - month * 137, account_id: account.id, counterparty: "Electricidad" });
    await s.call("POST", "/api/entries", { date: `2026-${mm}-12`, amount_cents: -2000, account_id: account.id, counterparty: "Supermercado" });
    await s.call("POST", "/api/entries", { date: `2026-${mm}-19`, amount_cents: -2100, account_id: account.id, counterparty: "Supermercado" });
  }
  const beforeCount = (await s.call("GET", "/api/entries?limit=100")).body.total;
  const result = await s.agent("recurring_candidates", { to: "2026-09", months: 12 });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.candidates.length, 2);
  const netflix = result.body.candidates.find((item) => item.counterparty === "Nétflix");
  assert.equal(netflix.frequency, "monthly");
  assert.equal(netflix.occurrences, 6);
  assert.equal(netflix.previous_typical_amount_cents, 999);
  assert.equal(netflix.latest_amount_cents, 1299);
  assert.equal(netflix.change_cents, 300);
  assert.equal(netflix.variable, false);
  assert.equal(netflix.price_change, true);
  assert.equal(netflix.baseline_occurrences, 5);
  assert.equal(netflix.baseline_last_date, "2026-07-05");
  assert.equal(netflix.evidence.length, 6);
  assert.equal(result.body.candidates.find((item) => item.counterparty === "Electricidad").variable, true);
  assert.equal(result.body.candidates.some((item) => item.counterparty === "Supermercado"), false);
  assert.equal((await s.call("GET", "/api/reports/recurring?to=2026-09&months=12")).body.candidates.length, 2);
  assert.equal((await s.call("GET", "/api/entries?limit=100")).body.total, beforeCount);
  assert.equal((await s.agent("recurring_candidates", { to: "bad" })).status, 400);
});
