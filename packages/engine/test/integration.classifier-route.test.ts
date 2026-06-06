import { SCHEMA_VERSION, type Flow } from "@construct/dsl";
import {
  createFakeProvider,
  getProvider,
  registerProvider,
  type ChatMessage,
} from "@construct/providers";
import { beforeEach, describe, expect, it } from "vitest";
import { registerExecutor, runFlow } from "../src/index.js";
import type { ExecutorContext, RunEvent } from "../src/types.js";

/**
 * Integration: a real DSL flow driven through the real engine runner, whose
 * `classifier` leaf calls a model through the real provider registry. Only the
 * model itself is faked — everything between the flow definition and the routing
 * decision is the production path: parse → validate → worklist → executor →
 * provider.chat → handle resolution → output.
 */

// A `classifier` executor: ask the model to pick a class, then route on it.
// This mirrors what @construct/nodes would register in production.
registerExecutor("classifier", async (ctx: ExecutorContext) => {
  const model = ctx.config.model as { provider: string; model: string };
  const classes = ctx.config.classes as string[];
  const provider = getProvider(model.provider);
  if (!provider) throw new Error(`no provider "${model.provider}"`);

  const messages: ChatMessage[] = [
    { role: "system", content: `Reply with exactly one of: ${classes.join(", ")}` },
    { role: "user", content: String(ctx.evaluate(ctx.config.prompt)) },
  ];
  const result = await provider.chat(messages, {
    model: model.model,
    toolChoice: "none",
    onDelta: ctx.onDelta,
  });

  const label = result.text.trim();
  if (!classes.includes(label)) {
    throw new Error(`classifier returned unknown class "${label}"`);
  }
  const writeTo = ctx.config.writeTo;
  return {
    handle: label,
    patch: typeof writeTo === "string" ? { [writeTo]: label } : undefined,
  };
});

const flow: Flow = {
  schemaVersion: SCHEMA_VERSION,
  id: "triage",
  name: "sentiment triage",
  channels: [
    { name: "text", type: "text", reducer: "lastValue" },
    { name: "sentiment", type: "text", reducer: "lastValue" },
  ],
  resources: [],
  nodes: [
    { id: "in", type: "input", config: { schema: { text: "text" } } },
    {
      id: "classify",
      type: "classifier",
      config: {
        model: { provider: "fake", model: "test-model" },
        prompt: "$.text",
        classes: ["positive", "negative"],
        writeTo: "sentiment",
      },
    },
    { id: "happy", type: "output", config: { from: "thanks for the kind words" } },
    { id: "sad", type: "output", config: { from: "sorry to hear that" } },
  ],
  edges: [
    { id: "e1", source: "in", target: "classify" },
    { id: "e2", source: "classify", target: "happy", sourceHandle: "positive" },
    { id: "e3", source: "classify", target: "sad", sourceHandle: "negative" },
  ],
  config: {},
  metadata: {},
};

// Classify by a keyword in the user's text so routing is deterministic.
function sentimentProvider() {
  return createFakeProvider({
    id: "fake",
    script: [
      (messages) => {
        const user = messages[messages.length - 1]!.content;
        const label = /love|great|good|kind/i.test(user) ? "positive" : "negative";
        return { text: label, stopReason: "end_turn" };
      },
    ],
  });
}

describe("flow → engine → provider integration", () => {
  beforeEach(() => {
    registerProvider(sentimentProvider());
  });

  it("routes to the positive branch when the model classifies positive", async () => {
    const res = await runFlow(flow, { input: { text: "I love this product" } });
    expect(res.status).toBe("completed");
    expect(res.state.sentiment).toBe("positive");
    expect(res.output).toBe("thanks for the kind words");
  });

  it("routes to the negative branch when the model classifies negative", async () => {
    const res = await runFlow(flow, { input: { text: "this is broken" } });
    expect(res.status).toBe("completed");
    expect(res.state.sentiment).toBe("negative");
    expect(res.output).toBe("sorry to hear that");
  });

  it("feeds the evaluated prompt into the provider call", async () => {
    const fake = sentimentProvider();
    registerProvider(fake);
    await runFlow(flow, { input: { text: "great job" } });
    expect(fake.calls.length).toBe(1);
    const userMsg = fake.calls[0]!.messages.at(-1)!;
    expect(userMsg.content).toBe("great job");
  });

  it("streams the model's text as token events for the classifier node", async () => {
    const events: RunEvent[] = [];
    await runFlow(flow, {
      input: { text: "good stuff" },
      onEvent: (e) => events.push(e),
    });
    const tokens = events.filter((e) => e.type === "token");
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.every((t) => t.nodeId === "classify")).toBe(true);
    expect(tokens.map((t) => t.data).join("")).toBe("positive");
    const order = events.filter((e) => e.type !== "token").map((e) => e.type);
    expect(order[0]).toBe("run-start");
    expect(order.at(-1)).toBe("run-finish");
  });

  it("fails the run when the model returns a class outside the set", async () => {
    registerProvider(
      createFakeProvider({ id: "fake", script: [{ text: "neutral" }] }),
    );
    const res = await runFlow(flow, { input: { text: "meh" } });
    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/unknown class "neutral"/);
  });
});
