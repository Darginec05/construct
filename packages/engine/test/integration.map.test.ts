import { SCHEMA_VERSION, type Flow } from "@construct/dsl";
import { describe, expect, it } from "vitest";
import { registerExecutor, registerFunction, runFlow } from "../src/index.js";
import type { RunState } from "../src/types.js";

/**
 * Integration: a real `map` node fanning a body sub-flow over a collection
 * through the real engine. Covers the things a chunked fan-out gets wrong —
 * order preservation when items settle out of order, the merge vs collect
 * aggregations, the three `onError` policies, and the per-item item/index
 * bindings winning over same-named parent channels.
 */

// Larger items resolve sooner, so completion order is the reverse of input
// order — the test then asserts the collected output is still input order.
registerFunction("slowDouble", async (ctx) => {
  const n = Number(ctx.state.item);
  await new Promise((r) => setTimeout(r, (10 - n) * 4));
  return n * 2;
});

registerFunction("doubleOrThrow", (ctx) => {
  const n = Number(ctx.state.item);
  if (n === 3) throw new Error("boom at 3");
  return n * 2;
});

// Writes a distinct channel per item, so a merge aggregation unions real keys
// instead of last-wins on one shared channel.
registerExecutor("tagWrite", (ctx) => ({
  patch: { [`k${ctx.state.index}`]: ctx.state.item },
}));

function bodyFlow(id: string, code: Record<string, unknown>, from: unknown): Flow {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    name: id,
    channels: [{ name: "out", type: "any", reducer: "lastValue" }],
    resources: [],
    nodes: [
      { id: "bin", type: "input", config: { schema: { item: "any", index: "any" } } },
      { id: "bcode", type: "code", config: { ...code, writeTo: "out" } },
      { id: "bout", type: "output", config: { from } },
    ],
    edges: [
      { id: "be0", source: "bin", target: "bcode" },
      { id: "be1", source: "bcode", target: "bout" },
    ],
    config: {},
    metadata: {},
  };
}

const echoBody: Flow = {
  schemaVersion: SCHEMA_VERSION,
  id: "body-echo",
  name: "body-echo",
  channels: [],
  resources: [],
  nodes: [
    { id: "bin", type: "input", config: { schema: { item: "any", index: "any" } } },
    { id: "bout", type: "output", config: { from: { it: "$.item", ix: "$.index" } } },
  ],
  edges: [{ id: "be0", source: "bin", target: "bout" }],
  config: {},
  metadata: {},
};

function buildParent(mapConfig: Record<string, unknown>): Flow {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "parent",
    name: "parent",
    channels: [
      { name: "list", type: "any", reducer: "lastValue" },
      { name: "result", type: "any", reducer: "lastValue" },
    ],
    resources: [],
    nodes: [
      { id: "in", type: "input", config: { schema: { list: "any" } } },
      { id: "m", type: "map", config: { ...mapConfig, writeTo: "result" } },
      { id: "out", type: "output", config: { from: "$.result" } },
    ],
    edges: [
      { id: "e0", source: "in", target: "m" },
      { id: "e1", source: "m", target: "out" },
    ],
    config: {},
    metadata: {},
  };
}

function run(mapConfig: Record<string, unknown>, body: Flow, input: RunState): ReturnType<typeof runFlow> {
  return runFlow(buildParent({ over: "$.list", body: body.id, ...mapConfig }), {
    input,
    flows: { [body.id]: body },
  });
}

describe("flow → engine → map", () => {
  const dbl = bodyFlow("body-double", { ref: "slowDouble" }, "$.out");

  it("collects per-item outputs in input order despite out-of-order settling", async () => {
    const res = await run({ aggregate: "collect", concurrency: 4 }, dbl, { list: [1, 2, 3, 4] });
    expect(res.status).toBe("completed");
    expect(res.output).toEqual([2, 4, 6, 8]);
  });

  it("seeds each iteration's item/index over same-named parent channels", async () => {
    const res = await run({ aggregate: "collect" }, echoBody, {
      list: [10, 20],
      item: "PARENT",
      index: 999,
    });
    expect(res.output).toEqual([
      { it: 10, ix: 0 },
      { it: 20, ix: 1 },
    ]);
  });

  it("merge unions each item's written channels into one record", async () => {
    const tagBody: Flow = {
      schemaVersion: SCHEMA_VERSION,
      id: "body-tag",
      name: "body-tag",
      channels: [],
      resources: [],
      nodes: [
        { id: "bin", type: "input", config: { schema: { item: "any", index: "any" } } },
        { id: "btag", type: "tagWrite", config: {} },
      ],
      edges: [{ id: "be0", source: "bin", target: "btag" }],
      config: {},
      metadata: {},
    };
    const res = await run({ aggregate: "merge", concurrency: 4 }, tagBody, { list: ["a", "b", "c"] });
    expect(res.output).toEqual({ k0: "a", k1: "b", k2: "c" });
  });

  it("returns an empty result when `over` is not an array", async () => {
    const res = await run({ aggregate: "collect" }, dbl, { list: "not-an-array" });
    expect(res.status).toBe("completed");
    expect(res.output).toEqual([]);
  });

  describe("onError", () => {
    const thrower = bodyFlow("body-throw", { ref: "doubleOrThrow" }, "$.out");

    it("fail aborts the whole map on the first error", async () => {
      const res = await run({ onError: "fail", concurrency: 1 }, thrower, { list: [1, 2, 3, 4] });
      expect(res.status).toBe("failed");
      expect(res.error).toMatch(/boom at 3/);
    });

    it("skip drops failed items and keeps the rest in order", async () => {
      const res = await run({ onError: "skip", concurrency: 1 }, thrower, { list: [1, 2, 3, 4] });
      expect(res.status).toBe("completed");
      expect(res.output).toEqual([2, 4, 8]);
    });

    it("collect surfaces failures inline as { error, index }", async () => {
      const res = await run({ onError: "collect", concurrency: 1 }, thrower, { list: [1, 2, 3, 4] });
      expect(res.status).toBe("completed");
      const out = res.output as unknown[];
      expect(out).toHaveLength(4);
      expect(out[0]).toBe(2);
      expect(out[1]).toBe(4);
      expect(out[2]).toMatchObject({ index: 2 });
      expect((out[2] as { error: string }).error).toMatch(/boom at 3/);
      expect(out[3]).toBe(8);
    });
  });
});
