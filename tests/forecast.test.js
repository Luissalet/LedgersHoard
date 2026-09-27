import { test } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "./helpers.js";

test("saved scenario projects by account without changing recorded entries", async () => {
  const s = await bootServer();
  try {
    const bank = (await s.call("POST", "/api/accounts", { name: "Banco", opening_balance: 100000 })).body;
    const cash = (await s.call("POST", "/api/accounts", { name: "Efectivo", opening_balance: 20000 })).body;
    await s.call("POST", "/api/entries", { account_id: bank.id, date: "2026-09-01", amount_cents: -10000 });
    await s.call("POST", "/api/transfers", { from_account_id: bank.id, to_account_id: cash.id, date: "2026-09-02", amount_cents: 5000 });
    const recorded = (await s.call("GET", "/api/forecast?from=2026-10&months=3")).body;
    assert.equal(recorded.rows[0].balance, 110000);
    const created = await s.call("POST", "/api/scenarios", { name: "Mudanza" });
    assert.equal(created.status, 201);
    const id = created.body.id;
    const rent = await s.call("POST", `/api/scenarios/${id}/lines`, { account_id: bank.id, label: "Alquiler", amount: "-200", start_month: "2026-10", cadence: "monthly" });
    assert.equal(rent.status, 201);
    const bonus = await s.call("POST", `/api/scenarios/${id}/lines`, { account_id: cash.id, label: "Extra", amount: "50", start_month: "2026-11" });
    assert.equal(bonus.status, 201);
    const projected = (await s.call("GET", `/api/forecast?scenario_id=${id}&from=2026-10&months=3`)).body;
    assert.deepEqual(projected.rows.map((r) => r.balance), [90000, 75000, 55000]);
    assert.deepEqual(projected.rows.map((r) => r.base_balance), [110000, 110000, 110000]);
    assert.equal(projected.rows[1].accounts.find((a) => a.account_id === cash.id).balance, 30000);
    assert.ok(projected.rows[0].lines.every((line) => line.source === "assumption"));
    assert.equal((await s.call("GET", "/api/entries")).body.total, 3, "the scenario creates no real entries");
    const edit = await s.call("PATCH", `/api/scenarios/${id}/lines/${rent.body.id}`, { amount: "-100" });
    assert.equal(edit.status, 200);
    assert.deepEqual((await s.call("GET", `/api/forecast?scenario_id=${id}&from=2026-10&months=3`)).body.rows.map((r) => r.balance), [100000, 95000, 85000]);
    await s.call("DELETE", `/api/scenarios/${id}/lines/${bonus.body.id}`);
    assert.deepEqual((await s.call("GET", `/api/forecast?scenario_id=${id}&from=2026-10&months=3`)).body.rows.map((r) => r.balance), [100000, 90000, 80000]);
    assert.equal((await s.call("DELETE", `/api/accounts/${bank.id}`)).status, 409);
    await s.call("DELETE", `/api/scenarios/${id}`);
    assert.equal((await s.call("GET", `/api/scenarios/${id}`)).status, 404);
    assert.equal((await s.call("GET", "/api/entries")).body.total, 3);
  } finally { await s.stop(); }
});

test("forecast validates scenarios and avoids summing different currencies", async () => {
  const s = await bootServer();
  try {
    const eur = (await s.call("POST", "/api/accounts", { name: "EUR", opening_balance: 10000 })).body;
    await s.call("POST", "/api/accounts", { name: "USD", currency: "USD", opening_balance: 20000 });
    const id = (await s.call("POST", "/api/scenarios", { name: "Viaje" })).body.id;
    assert.equal((await s.call("POST", `/api/scenarios/${id}/lines`, { account_id: eur.id, label: "Error", amount: "-10", start_month: "2026-12", end_month: "2026-10", cadence: "monthly" })).status, 400);
    const out = (await s.call("GET", `/api/forecast?scenario_id=${id}&from=2026-10&months=2`)).body;
    assert.equal(out.rows[0].balance, null);
    assert.equal(out.rows[0].accounts.length, 2);
    assert.equal((await s.call("GET", "/api/forecast?from=2026-99")).status, 400);
  } finally { await s.stop(); }
});

test("agent tools create, correct and read a scenario through the MCP bridge API", async () => {
  const s = await bootServer();
  try {
    const account = (await s.call("POST", "/api/accounts", { name: "Banco", opening_balance: 50000 })).body;
    const created = await s.agent("create_scenario", { name: "Viaje" });
    assert.equal(created.status, 200);
    const id = created.body.id;
    const line = await s.agent("add_scenario_line", { scenario_id: id, account: account.name, label: "Billete", amount: "-80", start_month: "2026-10", cadence: "once" });
    assert.equal(line.status, 200);
    const first = await s.agent("cash_forecast", { scenario_id: id, from: "2026-10", months: 2 });
    assert.deepEqual(first.body.rows.map((r) => r.balance), [42000, 42000]);
    const edit = await s.agent("update_scenario_line", { scenario_id: id, line_id: line.body.id, amount: "-100" });
    assert.equal(edit.status, 200);
    assert.equal((await s.agent("cash_forecast", { scenario_id: id, from: "2026-10", months: 1 })).body.rows[0].balance, 40000);
    assert.equal((await s.agent("get_scenario", { scenario_id: id })).body.lines.length, 1);
    await s.agent("delete_scenario_line", { scenario_id: id, line_id: line.body.id });
    assert.equal((await s.agent("cash_forecast", { scenario_id: id, from: "2026-10", months: 1 })).body.rows[0].balance, 50000);
    assert.equal((await s.call("GET", "/api/entries")).body.total, 0);
  } finally { await s.stop(); }
});

test("quarterly assumptions repeat every third month and stop at their end month", async () => {
  const s = await bootServer();
  try {
    const account = (await s.call("POST", "/api/accounts", { name: "Banco", opening_balance: 100000 })).body;
    const id = (await s.call("POST", "/api/scenarios", { name: "Cuota trimestral" })).body.id;
    assert.equal((await s.call("POST", `/api/scenarios/${id}/lines`, { account_id: account.id, label: "Cuota", amount: "-10", start_month: "2026-10", end_month: "2027-01", cadence: "quarterly" })).status, 201);
    const rows = (await s.call("GET", `/api/forecast?scenario_id=${id}&from=2026-10&months=6`)).body.rows;
    assert.deepEqual(rows.map((r) => r.balance), [99000, 99000, 99000, 98000, 98000, 98000]);
    assert.deepEqual(rows.map((r) => r.lines.length), [1, 0, 0, 1, 0, 0]);
  } finally { await s.stop(); }
});
