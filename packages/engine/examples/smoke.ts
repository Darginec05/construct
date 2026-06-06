import assert from "node:assert/strict";
import { SCHEMA_VERSION, type Flow } from "@construct/dsl";
import { registerExecutor, runFlow } from "../dist/index.js";

/** Fake leaf executors so the runner can be exercised without real providers. */
registerExecutor("inc", (ctx) => ({
  patch: { result: Number(ctx.state.n ?? 0) + 1, log: "step" },
}));
registerExecutor("setA", () => ({ patch: { a: 1 } }));
registerExecutor("setB", () => ({ patch: { b: 2 } }));
registerExecutor("sum", (ctx) => ({
  patch: { sum: Number(ctx.state.a ?? 0) + Number(ctx.state.b ?? 0) },
}));
registerExecutor("bump", (ctx) => ({ patch: { n: Number(ctx.state.n ?? 0) + 1 } }));

// 1. input -> leaf executor (with append reducer) -> branch -> output
const linear: Flow = {
  schemaVersion: SCHEMA_VERSION,
  id: "linear",
  name: "linear+branch",
  channels: [
    { name: "n", type: "json", reducer: "lastValue" },
    { name: "result", type: "json", reducer: "lastValue" },
    { name: "log", type: "text", reducer: "append" },
  ],
  resources: [],
  nodes: [
    { id: "in", type: "input", config: { schema: { n: "json" } } },
    { id: "step", type: "inc", config: {} },
    { id: "gate", type: "branch", config: { condition: "$.result" } },
    { id: "out", type: "output", config: { from: "$.result" } },
  ],
  edges: [
    { id: "e1", source: "in", target: "step" },
    { id: "e2", source: "step", target: "gate" },
    { id: "e3", source: "gate", target: "out", sourceHandle: "true" },
  ],
  config: {},
  metadata: {},
};

// 2. fan-out -> join(all) -> combine. Combine must run exactly once.
const join: Flow = {
  schemaVersion: SCHEMA_VERSION,
  id: "join",
  name: "and-barrier",
  channels: [
    { name: "a", type: "json", reducer: "lastValue" },
    { name: "b", type: "json", reducer: "lastValue" },
    { name: "sum", type: "json", reducer: "append" },
  ],
  resources: [],
  nodes: [
    { id: "in", type: "input", config: {} },
    { id: "forkA", type: "setA", config: {} },
    { id: "forkB", type: "setB", config: {} },
    { id: "barrier", type: "join", config: { mode: "all" } },
    { id: "combine", type: "sum", config: {} },
    { id: "out", type: "output", config: { from: "$.sum" } },
  ],
  edges: [
    { id: "e1", source: "in", target: "forkA" },
    { id: "e2", source: "in", target: "forkB" },
    { id: "e3", source: "forkA", target: "barrier" },
    { id: "e4", source: "forkB", target: "barrier" },
    { id: "e5", source: "barrier", target: "combine" },
    { id: "e6", source: "combine", target: "out" },
  ],
  config: {},
  metadata: {},
};

// 3. A join(all) starved by a branch (only one of two edges ever delivers)
//    must surface as a stalled barrier, not silently complete.
const deadlock: Flow = {
  schemaVersion: SCHEMA_VERSION,
  id: "deadlock",
  name: "starved-join",
  channels: [{ name: "ok", type: "json", reducer: "lastValue" }],
  resources: [],
  nodes: [
    { id: "in", type: "input", config: {} },
    { id: "gate", type: "branch", config: { condition: "true" } },
    { id: "barrier", type: "join", config: { mode: "all" } },
    { id: "out", type: "output", config: { from: "$.ok" } },
  ],
  edges: [
    { id: "e1", source: "in", target: "gate" },
    { id: "e2", source: "gate", target: "barrier", sourceHandle: "true" },
    { id: "e3", source: "gate", target: "barrier", sourceHandle: "false" },
    { id: "e4", source: "barrier", target: "out" },
  ],
  config: {},
  metadata: {},
};

// 4. Two distinct edges from the same source into a join(all): the barrier
//    must count edges, not deliveries, and fire once both arrive.
const parallelEdges: Flow = {
  schemaVersion: SCHEMA_VERSION,
  id: "parallel-edges",
  name: "same-source-join",
  channels: [{ name: "hit", type: "json", reducer: "append" }],
  resources: [],
  nodes: [
    { id: "in", type: "input", config: {} },
    { id: "barrier", type: "join", config: { mode: "all" } },
    { id: "mark", type: "setA", config: {} },
    { id: "out", type: "output", config: { from: "$.a" } },
  ],
  edges: [
    { id: "e1", source: "in", target: "barrier" },
    { id: "e2", source: "in", target: "barrier" },
    { id: "e3", source: "barrier", target: "mark" },
    { id: "e4", source: "mark", target: "out" },
  ],
  config: {},
  metadata: {},
};

// 5. loop: body increments n; writeTo captures the final output.
const loopBody: Flow = {
  schemaVersion: SCHEMA_VERSION,
  id: "loop-body",
  name: "bump-once",
  channels: [{ name: "n", type: "json", reducer: "lastValue" }],
  resources: [],
  nodes: [
    { id: "in", type: "input", config: {} },
    { id: "b", type: "bump", config: {} },
    { id: "out", type: "output", config: { from: "$.n" } },
  ],
  edges: [
    { id: "e1", source: "in", target: "b" },
    { id: "e2", source: "b", target: "out" },
  ],
  config: {},
  metadata: {},
};
const looping: Flow = {
  schemaVersion: SCHEMA_VERSION,
  id: "looping",
  name: "loop-writeTo",
  channels: [
    { name: "n", type: "json", reducer: "lastValue" },
    { name: "total", type: "json", reducer: "lastValue" },
  ],
  resources: [],
  nodes: [
    { id: "in", type: "input", config: {} },
    {
      id: "rep",
      type: "loop",
      config: { body: "loop-body", maxIterations: 3, writeTo: "total" },
    },
    { id: "out", type: "output", config: { from: "$.total" } },
  ],
  edges: [
    { id: "e1", source: "in", target: "rep" },
    { id: "e2", source: "rep", target: "out" },
  ],
  config: {},
  metadata: {},
};

// 6. A human pause inside a subflow must bubble up with a prefixed node id.
const askBody: Flow = {
  schemaVersion: SCHEMA_VERSION,
  id: "ask-body",
  name: "nested-human",
  channels: [{ name: "n", type: "json", reducer: "lastValue" }],
  resources: [],
  nodes: [
    { id: "in", type: "input", config: {} },
    { id: "ask", type: "human", config: { mode: "approve" } },
    { id: "out", type: "output", config: { from: "$.n" } },
  ],
  edges: [
    { id: "e1", source: "in", target: "ask" },
    { id: "e2", source: "ask", target: "out", sourceHandle: "approved" },
  ],
  config: {},
  metadata: {},
};
const nested: Flow = {
  schemaVersion: SCHEMA_VERSION,
  id: "nested",
  name: "subflow-pause",
  channels: [{ name: "n", type: "json", reducer: "lastValue" }],
  resources: [],
  nodes: [
    { id: "in", type: "input", config: {} },
    { id: "sub", type: "subflow", config: { flow: "ask-body", inputs: {} } },
    { id: "out", type: "output", config: { from: "$.n" } },
  ],
  edges: [
    { id: "e1", source: "in", target: "sub" },
    { id: "e2", source: "sub", target: "out" },
  ],
  config: {},
  metadata: {},
};

async function main(): Promise<void> {
  const r1 = await runFlow(linear, { input: { n: 5 } });
  assert.equal(r1.status, "completed");
  assert.equal(r1.state.result, 6, "leaf executor + lastValue");
  assert.deepEqual(r1.state.log, ["step"], "append reducer");
  assert.equal(r1.output, 6, "output node reads $.result");

  const r2 = await runFlow(join, { input: {} });
  assert.equal(r2.status, "completed");
  assert.deepEqual(r2.state.sum, [3], "join(all) fires once → combine runs once");

  // human with no resolver pauses
  const pausing: Flow = {
    ...linear,
    id: "pause",
    nodes: [
      { id: "in", type: "input", config: {} },
      { id: "ask", type: "human", config: { mode: "approve" } },
      { id: "out", type: "output", config: { from: "$.n" } },
    ],
    edges: [
      { id: "e1", source: "in", target: "ask" },
      { id: "e2", source: "ask", target: "out", sourceHandle: "approved" },
    ],
  };
  const r3 = await runFlow(pausing, {});
  assert.equal(r3.status, "paused");
  assert.deepEqual(r3.pause, { nodeId: "ask", exits: ["approved", "rejected"] });

  // 3. starved join → failed, not a silent completion
  const r4 = await runFlow(deadlock, {});
  assert.equal(r4.status, "failed", "starved join surfaces as failure");
  assert.match(String(r4.error), /stalled/, "error names the stalled barrier");

  // 4. two edges from one source satisfy a join(all)
  const r5 = await runFlow(parallelEdges, {});
  assert.equal(r5.status, "completed", "parallel edges satisfy join(all)");
  assert.equal(r5.output, 1, "barrier fired and combine ran");

  // 5. loop runs the body maxIterations times and writes the final output
  const r6 = await runFlow(looping, { input: { n: 0 }, flows: { "loop-body": loopBody } });
  assert.equal(r6.status, "completed");
  assert.equal(r6.state.total, 3, "loop writeTo captures last output after 3 bumps");

  // 6. a pause nested in a subflow bubbles up with a prefixed node id
  const r7 = await runFlow(nested, { flows: { "ask-body": askBody } });
  assert.equal(r7.status, "paused");
  assert.deepEqual(r7.pause, {
    nodeId: "sub/ask",
    exits: ["approved", "rejected"],
  });

  console.log("engine smoke: all assertions passed");
  console.log("  linear  ->", JSON.stringify(r1.state), "output", r1.output);
  console.log("  join    ->", JSON.stringify(r2.state));
  console.log("  pause   ->", JSON.stringify(r3.pause));
  console.log("  deadlock->", r4.error);
  console.log("  parallel->", JSON.stringify(r5.output));
  console.log("  loop    ->", JSON.stringify(r6.state));
  console.log("  nested  ->", JSON.stringify(r7.pause));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
