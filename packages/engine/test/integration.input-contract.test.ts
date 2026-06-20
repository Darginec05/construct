import { SCHEMA_VERSION, type Flow, type InputField } from "@construct/dsl";
import { describe, expect, it } from "vitest";
import { runFlow } from "../src/index.js";
import type { RunState } from "../src/types.js";

/**
 * Integration: the engine enforces an input node's declared contract on the
 * top-level run payload — required fields must be present, declared defaults are
 * filled — but skips that enforcement for nested loop / map / subflow bodies,
 * whose input is seeded from the parent run state rather than an external caller.
 */

function flow(schema: Record<string, InputField | string>): Flow {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "contract",
    name: "contract",
    channels: [],
    resources: [],
    nodes: [
      { id: "in", type: "input", config: { schema } },
      { id: "out", type: "output", config: { from: { name: "$.name", topK: "$.topK" } } },
    ],
    edges: [{ id: "e0", source: "in", target: "out" }],
    config: {},
    metadata: {},
  };
}

function run(schema: Record<string, InputField | string>, input: RunState): ReturnType<typeof runFlow> {
  return runFlow(flow(schema), { input });
}

describe("flow → engine → input contract", () => {
  it("fails the run when a required field is missing", async () => {
    const res = await run({ name: "text" }, {});
    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/input contract/);
    expect(res.error).toMatch(/name/);
  });

  it("completes when the required field is supplied", async () => {
    const res = await run({ name: "text" }, { name: "Ada" });
    expect(res.status).toBe("completed");
    expect(res.output).toMatchObject({ name: "Ada" });
  });

  it("fills a declared default for a missing optional field", async () => {
    const schema: Record<string, InputField> = {
      name: { type: "text", required: true },
      topK: { type: "json", required: false, default: 5 },
    };
    const res = await run(schema, { name: "Ada" });
    expect(res.status).toBe("completed");
    expect(res.output).toMatchObject({ name: "Ada", topK: 5 });
  });

  it("does not enforce the contract on a nested map body", async () => {
    const body: Flow = {
      schemaVersion: SCHEMA_VERSION,
      id: "body",
      name: "body",
      channels: [],
      resources: [],
      nodes: [
        // Declares a required field the parent never supplies under this name;
        // the map seeds `item`/`index`, so enforcement here would wrongly fail.
        { id: "bin", type: "input", config: { schema: { mustExist: "text" } } },
        { id: "bout", type: "output", config: { from: "$.item" } },
      ],
      edges: [{ id: "be0", source: "bin", target: "bout" }],
      config: {},
      metadata: {},
    };
    const parent: Flow = {
      schemaVersion: SCHEMA_VERSION,
      id: "parent",
      name: "parent",
      channels: [],
      resources: [],
      nodes: [
        { id: "in", type: "input", config: { schema: { list: "json" } } },
        { id: "m", type: "map", config: { over: "$.list", body: "body", writeTo: "result" } },
        { id: "out", type: "output", config: { from: "$.result" } },
      ],
      edges: [
        { id: "e0", source: "in", target: "m" },
        { id: "e1", source: "m", target: "out" },
      ],
      config: {},
      metadata: {},
    };
    const res = await runFlow(parent, { input: { list: [1, 2] }, flows: { body } });
    expect(res.status).toBe("completed");
    expect(res.output).toEqual([1, 2]);
  });
});
