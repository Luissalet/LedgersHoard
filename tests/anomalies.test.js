import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "./helpers.js";

let s;
before(async () => { s = await bootServer(); });
after(async () => { await s.stop(); });

const add = (account_id, date, amount_cents, counterparty) =>
  s.call("POST", "/api/entries", { date, amount_cents, account_id, counterparty });

test("flags duplicates, spikes, extra charges and large first charges without touching entries", async () => {
  const account = (await s.agent("upsert_account", { name: "Banco anomalías" })).body.account;
  for (let month = 3; month <= 8; month++) {
    const mm = String(month).padStart(2, "0");
    await add(account.id, `2026-${mm}-05`, -1099, "Gimnasio Ejemplo");
    await add(account.id, `2026-${mm}-10`, -3000 - month * 50, "Supermercado Ejemplo");
    await add(account.id, `2026-${mm}-18`, -2500, "Supermercado Ejemplo");
    await add(account.id, `2026-${mm}-20`, -4500, "Luz Hogar");
  }
  // September: a double charge, a spike, an extra monthly charge and a big first charge.
  await add(account.id, "2026-09-05", -1099, "Gimnasio Ejemplo");
  await add(account.id, "2026-09-07", -1099, "Gimnasio Ejemplo");
  await add(account.id, "2026-09-12", -14000, "Supermercado Ejemplo");
  await add(account.id, "2026-09-03", -4500, "Luz Hogar");
  await add(account.id, "2026-09-21", -4700, "Luz Hogar");
  await add(account.id, "2026-09-25", -32000, "Taller Mecánico Nuevo");
  await add(account.id, "2026-09-26", -900, "Panadería Nueva");
  const beforeCount = (await s.call("GET", "/api/entries?limit=200")).body.total;

  const result = await s.agent("spending_anomalies", { to: "2026-09", recent_days: 30 });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const byKind = (kind) => result.body.anomalies.filter((item) => item.kind === kind);
  assert.equal(result.body.recent_from, "2026-09-01");

  const [dup] = byKind("duplicate");
  assert.equal(byKind("duplicate").length, 1);
  assert.equal(dup.counterparty, "Gimnasio Ejemplo");
  assert.equal(dup.date, "2026-09-07");
  assert.equal(dup.severity, "high");
  assert.deepEqual(dup.evidence.map((e) => e.date), ["2026-09-05", "2026-09-07"]);
  assert.match(dup.reason, /a 2 días/);

  const [spike] = byKind("amount_spike");
  assert.equal(byKind("amount_spike").length, 1);
  assert.equal(spike.counterparty, "Supermercado Ejemplo");
  assert.equal(spike.amount_cents, 14000);
  assert.ok(spike.typical_amount_cents > 2500 && spike.typical_amount_cents < 3500);
  assert.equal(spike.severity, "high");

  const [extra] = byKind("extra_charge");
  assert.equal(byKind("extra_charge").length, 1);
  assert.equal(extra.counterparty, "Luz Hogar");
  assert.equal(extra.date, "2026-09-21");

  const [fresh] = byKind("new_merchant_large");
  assert.equal(byKind("new_merchant_large").length, 1);
  assert.equal(fresh.counterparty, "Taller Mecánico Nuevo");
  assert.equal(result.body.anomalies.some((item) => item.counterparty === "Panadería Nueva"), false);
  assert.equal(result.body.anomalies.length, 4);

  // Older months are history, not findings; the REST route agrees with the tool.
  const rest = await s.call("GET", "/api/reports/anomalies?to=2026-09&recent_days=30");
  assert.equal(rest.status, 200);
  assert.equal(rest.body.anomalies.length, 4);
  assert.equal((await s.call("GET", "/api/reports/anomalies?to=2026-08&recent_days=30")).body.anomalies.length, 0);
  assert.equal((await s.call("GET", "/api/entries?limit=200")).body.total, beforeCount);
  assert.equal((await s.agent("spending_anomalies", { to: "bad" })).status, 400);
  assert.equal((await s.agent("spending_anomalies", { to: "2026-09", account: "Banco anomalías" })).body.anomalies.length, 4);
});
