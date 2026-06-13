import { SCHEMA_VERSION, type DataType, type Flow } from "@construct/dsl";
import { runFlow, type RunEvent } from "@construct/engine";
import { createFakeProvider, registerProvider, type ChatResult } from "@construct/providers";
import { defineTool, registerTool } from "@construct/tools";
import { describe, expect, it } from "vitest";
// Importing the package registers the real `agent` executor we exercise here.
import "../src/index.js";

/**
 * Production behaviors of the `agent` leaf beyond tier-gating (see agent-gate):
 * constrained structured output, a `required` loop that can actually finish,
 * token/step budgets, retry on transient failure, tool-result truncation, and
 * usage events. Only the model is faked; the engine path is real.
 */

const VERDICT_SCHEMA = {
  type: "object",
  properties: { pass: { type: "boolean" } },
  required: ["pass"],
} as const;

function flowWith(config: Record<string, unknown>, channelType: DataType = "text"): Flow {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "a",
    name: "a",
    channels: [{ name: "out", type: channelType, reducer: "lastValue" }],
    resources: [],
    nodes: [
      { id: "in", type: "input", config: { schema: {} } },
      {
        id: "agent",
        type: "agent",
        config: { model: { provider: "fake", model: "m" }, prompt: "go", writeTo: "out", ...config },
      },
      { id: "o", type: "output", config: { from: "$.out" } },
    ],
    edges: [
      { id: "e1", source: "in", target: "agent" },
      { id: "e2", source: "agent", target: "o" },
    ],
    config: {},
    metadata: {},
  };
}

describe("agent structured output", () => {
  it("captures the schema-constrained respond tool call as the result", async () => {
    const fake = createFakeProvider({
      id: "fake",
      script: [
        {
          text: "",
          toolCalls: [{ id: "r1", name: "respond", arguments: { pass: true } }],
          stopReason: "tool_use",
        },
      ],
    });
    registerProvider(fake);

    const res = await runFlow(flowWith({ output: { schema: VERDICT_SCHEMA } }, "json"), {
      input: {},
    });

    expect(res.status).toBe("completed");
    expect(res.state.out).toEqual({ pass: true });
    // The model was forced to use the schema-typed respond tool.
    const opts = fake.calls[0]!.options;
    expect(opts.toolChoice).toBe("required");
    const respond = opts.tools!.find((t) => t.name === "respond")!;
    expect(respond.parameters).toMatchObject({ type: "object", required: ["pass"] });
  });

  it("falls back to parsing prose JSON when the provider skips the tool", async () => {
    registerProvider(
      createFakeProvider({
        id: "fake",
        script: [{ text: '{"pass":false}', stopReason: "end_turn" }],
      }),
    );

    const res = await runFlow(flowWith({ output: { schema: VERDICT_SCHEMA } }, "json"), {
      input: {},
    });

    expect(res.status).toBe("completed");
    expect(res.state.out).toEqual({ pass: false });
  });
});

describe("agent tool loop", () => {
  it("finishes a required-tool loop instead of deadlocking on maxSteps", async () => {
    registerTool(
      defineTool({ name: "lookup", description: "Look up", tier: "read", run: () => "found" }),
    );
    const fake = createFakeProvider({
      id: "fake",
      script: [
        { text: "", toolCalls: [{ id: "c1", name: "lookup", arguments: {} }], stopReason: "tool_use" },
        { text: "done", stopReason: "end_turn" },
      ],
    });
    registerProvider(fake);

    const res = await runFlow(
      flowWith({ tools: ["lookup"], toolChoice: "required" }),
      { input: {} },
    );

    expect(res.status).toBe("completed");
    expect(res.output).toBe("done");
    // First turn forces a tool; the loop then relaxes so the model can answer.
    expect(fake.calls[0]!.options.toolChoice).toBe("required");
    expect(fake.calls[1]!.options.toolChoice).toBe("auto");
  });

  it("truncates an oversized tool result before feeding it back", async () => {
    registerTool(
      defineTool({
        name: "dump",
        description: "Big output",
        tier: "read",
        run: () => "x".repeat(20_000),
      }),
    );
    let fedBack = "";
    registerProvider(
      createFakeProvider({
        id: "fake",
        script: [
          { text: "", toolCalls: [{ id: "c1", name: "dump", arguments: {} }], stopReason: "tool_use" },
          (messages): ChatResult => {
            fedBack = String(messages.at(-1)!.content);
            return { text: "ok", stopReason: "end_turn" };
          },
        ],
      }),
    );

    const res = await runFlow(flowWith({ tools: ["dump"], toolChoice: "auto" }), { input: {} });

    expect(res.status).toBe("completed");
    expect(fedBack).toContain("[truncated");
    expect(fedBack.length).toBeLessThan(20_000);
  });
});

describe("agent budget", () => {
  it("fails when the cumulative token budget is exceeded", async () => {
    registerProvider(
      createFakeProvider({
        id: "fake",
        script: [{ text: "hi", stopReason: "end_turn", usage: { inputTokens: 120, outputTokens: 90 } }],
      }),
    );

    const res = await runFlow(flowWith({ budget: { maxTokens: 50 } }), { input: {} });

    expect(res.status).toBe("failed");
    expect(res.error).toContain("token budget exceeded");
  });

  it("caps iterations by budget.maxSteps", async () => {
    registerTool(
      defineTool({ name: "spin", description: "Loops", tier: "read", run: () => "again" }),
    );
    registerProvider(
      createFakeProvider({
        id: "fake",
        script: [
          { text: "", toolCalls: [{ id: "c1", name: "spin", arguments: {} }], stopReason: "tool_use" },
        ],
      }),
    );

    const res = await runFlow(
      flowWith({ tools: ["spin"], toolChoice: "auto", maxSteps: 8, budget: { maxSteps: 1 } }),
      { input: {} },
    );

    expect(res.status).toBe("failed");
    expect(res.error).toContain("hit maxSteps (1)");
  });
});

describe("agent per-run tool injection", () => {
  it("resolves a tool passed via RunOptions.tools without global registration", async () => {
    const fake = createFakeProvider({
      id: "fake",
      script: [
        { text: "", toolCalls: [{ id: "c1", name: "injected", arguments: {} }], stopReason: "tool_use" },
        { text: "done", stopReason: "end_turn" },
      ],
    });
    registerProvider(fake);
    const injected = defineTool({
      name: "injected",
      description: "Per-run only",
      tier: "read",
      run: () => "from-injection",
    });

    const res = await runFlow(
      flowWith({ tools: ["injected"], toolChoice: "auto" }),
      { input: {}, tools: { injected } },
    );

    expect(res.status).toBe("completed");
    expect(res.output).toBe("done");
    // The model saw the injected tool in its toolset even though it was never
    // added to the global registry.
    expect(fake.calls[0]!.options.tools!.map((t) => t.name)).toContain("injected");
  });

  it("fails to resolve an injected tool when it is not passed for the run", async () => {
    registerProvider(
      createFakeProvider({ id: "fake", script: [{ text: "x", stopReason: "end_turn" }] }),
    );

    const res = await runFlow(
      flowWith({ tools: ["never-registered"], toolChoice: "auto" }),
      { input: {} },
    );

    expect(res.status).toBe("failed");
    expect(res.error).toContain("never-registered");
  });
});

describe("agent resilience & observability", () => {
  it("retries a transient model failure before succeeding", async () => {
    registerProvider(
      createFakeProvider({
        id: "fake",
        script: [
          () => {
            throw new Error("rate limited");
          },
          { text: "recovered", stopReason: "end_turn" },
        ],
      }),
    );

    const res = await runFlow(flowWith({}), { input: {} });

    expect(res.status).toBe("completed");
    expect(res.output).toBe("recovered");
  });

  it("emits a usage event per model turn", async () => {
    registerProvider(
      createFakeProvider({
        id: "fake",
        script: [{ text: "hi", stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 5 } }],
      }),
    );
    const events: RunEvent[] = [];

    await runFlow(flowWith({}), { input: {}, onEvent: (e) => events.push(e) });

    const usage = events.filter((e) => e.type === "usage");
    expect(usage).toHaveLength(1);
    expect(usage[0]!.nodeId).toBe("agent");
    expect(usage[0]!.data).toEqual({ inputTokens: 10, outputTokens: 5 });
  });
});
