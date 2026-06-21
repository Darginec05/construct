import { SCHEMA_VERSION, type Flow } from "@construct/dsl";
import { runFlow, type RunEvent } from "@construct/engine";
import {
  createFakeProvider,
  registerProvider,
  type ChatResult,
  type FakeProvider,
} from "@construct/providers";
import { describe, expect, it } from "vitest";
// Importing the package registers the real `router` executor we exercise here.
import "../src/index.js";

/**
 * The production `router` leaf must make a constrained choice: it advertises the
 * `select_route` tool (one enum arg), forces the call, and routes on the returned
 * branch — deterministically (temperature 0) and bounded (maxTokens). These tests
 * drive the real executor through the engine with only the model faked.
 */

function buildFlow(fallback: boolean): Flow {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "triage",
    name: "triage",
    channels: [
      { name: "text", type: "text", reducer: "lastValue" },
      { name: "choice", type: "text", reducer: "lastValue" },
    ],
    resources: [],
    nodes: [
      { id: "in", type: "input", config: { schema: { text: "text" } } },
      {
        id: "route",
        type: "router",
        config: {
          model: { provider: "fake", model: "m" },
          prompt: "$.text",
          classes: [
            { name: "positive", description: "happy, grateful, kind" },
            { name: "negative", description: "angry, broken, complaint" },
          ],
          fallback,
          writeTo: "choice",
        },
      },
      { id: "pos", type: "output", config: { from: "went positive" } },
      { id: "neg", type: "output", config: { from: "went negative" } },
      ...(fallback
        ? [{ id: "fb", type: "output", config: { from: "went fallback" } }]
        : []),
    ],
    edges: [
      { id: "e1", source: "in", target: "route" },
      { id: "e2", source: "route", target: "pos", sourceHandle: "positive" },
      { id: "e3", source: "route", target: "neg", sourceHandle: "negative" },
      ...(fallback
        ? [{ id: "e4", source: "route", target: "fb", sourceHandle: "fallback" }]
        : []),
    ],
    config: {},
    metadata: {},
  };
}

function toolCallResult(route: string, reason = "fits best"): ChatResult {
  return {
    text: "",
    toolCalls: [{ id: "t1", name: "select_route", arguments: { reason, route } }],
    stopReason: "tool_use",
  };
}

const DEFAULT_CLARIFICATION =
  "Could you add a bit more detail about what you'd like me to do?";

/** A fallback-routing tool call that may carry a clarifying question. */
function clarifyResult(route: string, clarification?: string): ChatResult {
  const args: Record<string, unknown> = { reason: "ambiguous", route };
  if (clarification !== undefined) args.clarification = clarification;
  return {
    text: "",
    toolCalls: [{ id: "t1", name: "select_route", arguments: args }],
    stopReason: "tool_use",
  };
}

/** Router with `clarifyTo` wired; the fallback branch surfaces the question. */
function buildClarifyFlow(): Flow {
  const flow = buildFlow(true);
  flow.channels.push({ name: "ask", type: "text", reducer: "lastValue" });
  (flow.nodes[1]!.config as { clarifyTo?: string }).clarifyTo = "ask";
  const fb = flow.nodes.find((n) => n.id === "fb");
  if (fb) fb.config = { from: "$.ask" };
  return flow;
}

function provider(step: ChatResult): FakeProvider {
  const p = createFakeProvider({ id: "fake", script: [step] });
  registerProvider(p);
  return p;
}

describe("router node", () => {
  it("routes on the branch the model commits to via the tool call", async () => {
    provider(toolCallResult("negative"));
    const res = await runFlow(buildFlow(false), { input: { text: "this is broken" } });
    expect(res.status).toBe("completed");
    expect(res.state.choice).toBe("negative");
    expect(res.output).toBe("went negative");
  });

  it("forces a constrained, deterministic, bounded call", async () => {
    const fake = provider(toolCallResult("positive"));
    await runFlow(buildFlow(true), { input: { text: "thank you so much" } });

    expect(fake.calls.length).toBe(1);
    const opts = fake.calls[0]!.options;
    expect(opts.temperature).toBe(0);
    expect(opts.maxTokens).toBe(256);
    expect(opts.toolChoice).toBe("required");
    expect(opts.tools).toHaveLength(1);
    const tool = opts.tools![0]!;
    expect(tool.name).toBe("select_route");
    const route = (tool.parameters.properties as { route: { enum: string[] } }).route;
    // fallback on → enum carries the extra "fallback" choice.
    expect(route.enum).toEqual(["positive", "negative", "fallback"]);
  });

  it("honors a model-set temperature instead of forcing 0", async () => {
    const fake = createFakeProvider({ id: "fake", script: [toolCallResult("positive")] });
    registerProvider(fake);
    const flow = buildFlow(false);
    (flow.nodes[1]!.config.model as { temperature?: number }).temperature = 0.3;
    await runFlow(flow, { input: { text: "great" } });
    expect(fake.calls[0]!.options.temperature).toBe(0.3);
  });

  it("falls back to matching prose when a provider ignores the tool", async () => {
    provider({ text: "I'd route this to negative.", stopReason: "end_turn" });
    const res = await runFlow(buildFlow(false), { input: { text: "ugh" } });
    expect(res.state.choice).toBe("negative");
    expect(res.output).toBe("went negative");
  });

  it("routes to fallback when the model picks it", async () => {
    provider(toolCallResult("fallback", "not confident"));
    const res = await runFlow(buildFlow(true), { input: { text: "???" } });
    expect(res.state.choice).toBe("fallback");
    expect(res.output).toBe("went fallback");
  });

  it("fails loudly when the pick is unknown and no fallback is wired", async () => {
    provider(toolCallResult("sideways"));
    const res = await runFlow(buildFlow(false), { input: { text: "meh" } });
    expect(res.status).toBe("failed");
    expect(res.error).toContain("did not return a listed route");
  });

  it("routes to fallback when the pick is unknown and fallback is on", async () => {
    provider(toolCallResult("sideways"));
    const res = await runFlow(buildFlow(true), { input: { text: "meh" } });
    expect(res.state.choice).toBe("fallback");
    expect(res.output).toBe("went fallback");
  });

  it("stores the decision reason in reasonTo when set", async () => {
    provider(toolCallResult("positive", "clearly grateful"));
    const flow = buildFlow(false);
    (flow.nodes[1]!.config as { reasonTo?: string }).reasonTo = "why";
    const res = await runFlow(flow, { input: { text: "thanks!" } });
    expect(res.state.choice).toBe("positive");
    expect(res.state.why).toBe("clearly grateful");
  });

  it("streams the decision reason as a token event", async () => {
    provider(toolCallResult("positive", "clearly grateful"));
    const events: RunEvent[] = [];
    await runFlow(buildFlow(false), {
      input: { text: "thanks!" },
      onEvent: (e) => events.push(e),
    });
    const tokens = events.filter((e) => e.type === "token" && e.nodeId === "route");
    expect(tokens.map((t) => t.data).join("")).toContain("clearly grateful");
  });

  it("offers a clarification arg only when clarifyTo is wired", async () => {
    const fake = provider(clarifyResult("fallback", "Which project?"));
    await runFlow(buildClarifyFlow(), { input: { text: "do the thing" } });
    const props = fake.calls[0]!.options.tools![0]!.parameters.properties as Record<
      string,
      unknown
    >;
    expect(props.clarification).toBeDefined();
  });

  it("writes the model's clarifying question to clarifyTo on fallback", async () => {
    provider(clarifyResult("fallback", "Which project did you mean?"));
    const res = await runFlow(buildClarifyFlow(), { input: { text: "update it" } });
    expect(res.state.choice).toBe("fallback");
    expect(res.state.ask).toBe("Which project did you mean?");
    expect(res.output).toBe("Which project did you mean?");
  });

  it("defaults the question when fallback is chosen without one", async () => {
    provider(clarifyResult("fallback"));
    const res = await runFlow(buildClarifyFlow(), { input: { text: "???" } });
    expect(res.state.ask).toBe(DEFAULT_CLARIFICATION);
  });

  it("does not write a question on a confident route", async () => {
    provider(clarifyResult("positive", "ignored on a confident pick"));
    const res = await runFlow(buildClarifyFlow(), { input: { text: "thanks!" } });
    expect(res.state.choice).toBe("positive");
    expect(res.state.ask).toBeUndefined();
  });
});
