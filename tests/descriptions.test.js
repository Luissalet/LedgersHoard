// The first line of a tool description is what a tool-retrieval index sees
// (it truncates around 110 characters): short, with English and Spanish words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TOOLS } from "../server/agent-tools.js";

test("first line of every tool description fits the tool index", () => {
  for (const t of TOOLS) {
    const first = t.description.split("\n")[0];
    assert.ok(first.length <= 110, `${t.name}: ${first.length} chars`);
    assert.ok(first.trim().length > 0, t.name);
    assert.match(t.description, /\nSinónimos: /, `${t.name} keeps its Sinónimos line`);
  }
});

test("no tool description exceeds 750 characters and trimmed tools keep their inputs", () => {
  for (const t of TOOLS) assert.ok(t.description.length <= 750, `${t.name}: ${t.description.length} chars`);
  const expected = { spending_anomalies: ["account", "months", "recent_days", "to"] };
  for (const [name, props] of Object.entries(expected)) {
    const tool = TOOLS.find((x) => x.name === name);
    assert.ok(tool, name);
    assert.deepEqual(Object.keys(tool.schema.shape).sort(), props.slice().sort(), name);
  }
});