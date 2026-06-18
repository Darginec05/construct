import { SCHEMA_VERSION, type Flow, type SwitchCase } from "@construct/dsl";
import { describe, expect, it } from "vitest";
import { runFlow } from "../src/index.js";

/**
 * Integration: a real DSL flow through the real engine, exercising the `switch`
 * node end to end — subject `on` compared against each case to pick which
 * downstream edge the scheduler follows. The comparison reuses the Branch
 * operators (`evalRule`); this covers the routing wiring around it, including
 * the synthetic `default` handle and the legacy bare-string case form.
 */

function buildFlow(cases: (SwitchCase | string)[], handles: string[]): Flow {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "router",
    name: "router",
    channels: [{ name: "score", type: "any", reducer: "lastValue" }],
    resources: [],
    nodes: [
      { id: "in", type: "input", config: { schema: { score: "any" } } },
      { id: "s", type: "switch", config: { on: "$.score", cases } },
      ...handles.map((h) => ({ id: h, type: "output", config: { from: `took ${h}` } })),
    ],
    edges: [
      { id: "e0", source: "in", target: "s" },
      ...handles.map((h) => ({ id: `e-${h}`, source: "s", target: h, sourceHandle: h })),
    ],
    config: {},
    metadata: {},
  };
}

const tiers: SwitchCase[] = [
  { label: "high", op: "gte", value: "80" },
  { label: "mid", op: "gte", value: "50" },
];

describe("flow → engine → switch routing", () => {
  it("takes the first matching case top to bottom", async () => {
    const res = await runFlow(buildFlow(tiers, ["high", "mid", "default"]), { input: { score: 90 } });
    expect(res.output).toBe("took high");
  });

  it("falls through to a later case when the first fails", async () => {
    const res = await runFlow(buildFlow(tiers, ["high", "mid", "default"]), { input: { score: 60 } });
    expect(res.output).toBe("took mid");
  });

  it("takes default when no case matches", async () => {
    const res = await runFlow(buildFlow(tiers, ["high", "mid", "default"]), { input: { score: 10 } });
    expect(res.output).toBe("took default");
  });

  it("routes a legacy bare-string case by exact equality", async () => {
    const res = await runFlow(buildFlow(["gold", "silver"], ["gold", "silver", "default"]), {
      input: { score: "silver" },
    });
    expect(res.output).toBe("took silver");
  });

  it("completes with no output when the chosen handle has no edge", async () => {
    // score 10 → default, but only high/mid are wired → dead end, no output node reached.
    const res = await runFlow(buildFlow(tiers, ["high", "mid"]), { input: { score: 10 } });
    expect(res.status).toBe("completed");
    expect(res.output).toBeUndefined();
  });
});
