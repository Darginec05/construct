import { SCHEMA_VERSION, type Condition, type Flow } from "@construct/dsl";
import { describe, expect, it } from "vitest";
import { runFlow } from "../src/index.js";

/**
 * Integration: a real DSL flow driven through the real engine runner, exercising
 * the `branch` node end to end — parse → validate → worklist → `resolveHandle`
 * → which downstream edge the scheduler follows. The unit suite covers
 * `evalCondition` in isolation; this covers the routing wiring around it.
 */

function buildFlow(condition: Condition | string, opts: { wireFalse?: boolean } = {}): Flow {
  const wireFalse = opts.wireFalse ?? true;
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "gate",
    name: "gate",
    channels: [
      { name: "count", type: "any", reducer: "lastValue" },
      { name: "status", type: "text", reducer: "lastValue" },
      { name: "flag", type: "any", reducer: "lastValue" },
    ],
    resources: [],
    nodes: [
      { id: "in", type: "input", config: { schema: { count: "any", status: "text", flag: "any" } } },
      { id: "b", type: "branch", config: { condition } },
      { id: "hi", type: "output", config: { from: "took true" } },
      ...(wireFalse ? [{ id: "lo", type: "output", config: { from: "took false" } }] : []),
    ],
    edges: [
      { id: "e0", source: "in", target: "b" },
      { id: "e1", source: "b", target: "hi", sourceHandle: "true" },
      ...(wireFalse ? [{ id: "e2", source: "b", target: "lo", sourceHandle: "false" }] : []),
    ],
    config: {},
    metadata: {},
  };
}

const gt3: Condition = { combinator: "and", rules: [{ left: "$.count", op: "gt", right: "3" }] };

describe("flow → engine → branch routing", () => {
  it("follows the true edge when the condition holds", async () => {
    const res = await runFlow(buildFlow(gt3), { input: { count: 5 } });
    expect(res.status).toBe("completed");
    expect(res.output).toBe("took true");
  });

  it("follows the false edge when the condition fails", async () => {
    const res = await runFlow(buildFlow(gt3), { input: { count: 1 } });
    expect(res.status).toBe("completed");
    expect(res.output).toBe("took false");
  });

  it("takes true when any rule matches under an 'or' combinator", async () => {
    const cond: Condition = {
      combinator: "or",
      rules: [
        { left: "$.count", op: "gt", right: "100" },
        { left: "$.status", op: "eq", right: "vip" },
      ],
    };
    const res = await runFlow(buildFlow(cond), { input: { count: 1, status: "vip" } });
    expect(res.output).toBe("took true");
  });

  it("routes a legacy bare-string condition via truthiness", async () => {
    expect((await runFlow(buildFlow("$.flag"), { input: { flag: true } })).output).toBe("took true");
    expect((await runFlow(buildFlow("$.flag"), { input: { flag: false } })).output).toBe("took false");
  });

  it("takes the false edge for an empty rule set", async () => {
    const res = await runFlow(buildFlow({ combinator: "and", rules: [] }), { input: { count: 9 } });
    expect(res.status).toBe("completed");
    expect(res.output).toBe("took false");
  });

  it("completes with no output when the chosen handle has no edge", async () => {
    // Condition is false but only the true edge is wired → the false path is a
    // dead end; the run finishes without reaching an output node.
    const res = await runFlow(buildFlow(gt3, { wireFalse: false }), { input: { count: 1 } });
    expect(res.status).toBe("completed");
    expect(res.output).toBeUndefined();
  });
});
