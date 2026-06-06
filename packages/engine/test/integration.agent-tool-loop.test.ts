import { SCHEMA_VERSION, type Flow } from "@construct/dsl";
import {
  createFakeProvider,
  getProvider,
  registerProvider,
  type ChatMessage,
  type ModelProvider,
  type ToolSpec,
} from "@construct/providers";
import { beforeEach, describe, expect, it } from "vitest";
import { registerExecutor, runFlow } from "../src/index.js";
import type { ExecutorContext } from "../src/types.js";

/**
 * Integration: an `agent` leaf that runs a real multi-step tool-use loop on the
 * production engine path. The model is faked (scripted), but the loop itself —
 * advertise tools → model asks for one → engine executes it → result is fed back
 * → model continues — is the real control flow that @construct/nodes would ship.
 */

// --- a tiny tool layer the agent executor can resolve and invoke ------------

const toolInvocations: { name: string; args: Record<string, unknown> }[] = [];

const TOOL_IMPLS: Record<string, (args: Record<string, unknown>) => string> = {
  get_weather: (args) => {
    toolInvocations.push({ name: "get_weather", args });
    return `18C and sunny in ${String(args.city)}`;
  },
  suggest_outfit: (args) => {
    toolInvocations.push({ name: "suggest_outfit", args });
    return /sunny/i.test(String(args.conditions)) ? "sunglasses" : "umbrella";
  },
};

const TOOL_SPECS: Record<string, ToolSpec> = {
  get_weather: {
    name: "get_weather",
    description: "Current weather for a city",
    parameters: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
  },
  suggest_outfit: {
    name: "suggest_outfit",
    description: "Suggest an outfit for the given conditions",
    parameters: {
      type: "object",
      properties: { conditions: { type: "string" } },
      required: ["conditions"],
    },
  },
};

// The agent executor: drive the model/tool loop until it stops asking for tools.
registerExecutor("agent", async (ctx: ExecutorContext) => {
  const model = ctx.config.model as { provider: string; model: string };
  const provider = getProvider(model.provider);
  if (!provider) throw new Error(`no provider "${model.provider}"`);
  const toolNames = (ctx.config.tools as string[]) ?? [];
  const specs = toolNames.map((n) => TOOL_SPECS[n]!);
  const maxSteps = Number(ctx.config.maxSteps ?? 8);

  const messages: ChatMessage[] = [
    { role: "system", content: String(ctx.config.system ?? "") },
    { role: "user", content: String(ctx.evaluate(ctx.config.prompt)) },
  ];

  let final = "";
  for (let step = 0; step < maxSteps; step++) {
    const res = await provider.chat(messages, {
      model: model.model,
      tools: specs,
      toolChoice: ctx.config.toolChoice as "auto" | "required" | "none" | undefined,
      onDelta: ctx.onDelta,
    });
    if (!res.toolCalls || res.toolCalls.length === 0) {
      final = res.text;
      break;
    }
    messages.push({ role: "assistant", content: res.text, toolCalls: res.toolCalls });
    for (const call of res.toolCalls) {
      const impl = TOOL_IMPLS[call.name];
      const output = impl ? impl(call.arguments) : `error: unknown tool ${call.name}`;
      messages.push({ role: "tool", toolCallId: call.id, content: output });
    }
  }

  const writeTo = ctx.config.writeTo;
  return { patch: typeof writeTo === "string" ? { [writeTo]: final } : undefined };
});

function buildFlow(tools: string[], maxSteps?: number): Flow {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "weather-agent",
    name: "weather agent",
    channels: [
      { name: "city", type: "text", reducer: "lastValue" },
      { name: "answer", type: "text", reducer: "lastValue" },
    ],
    resources: [],
    nodes: [
      { id: "in", type: "input", config: { schema: { city: "text" } } },
      {
        id: "agent",
        type: "agent",
        config: {
          model: { provider: "fake", model: "test-model" },
          system: "You are a weather assistant.",
          prompt: "What should I wear in {{$.city}}?",
          tools,
          toolChoice: "auto",
          ...(maxSteps !== undefined ? { maxSteps } : {}),
          writeTo: "answer",
        },
      },
      { id: "out", type: "output", config: { from: "$.answer" } },
    ],
    edges: [
      { id: "e1", source: "in", target: "agent" },
      { id: "e2", source: "agent", target: "out" },
    ],
    config: {},
    metadata: {},
  };
}

describe("agent tool-loop integration", () => {
  beforeEach(() => {
    toolInvocations.length = 0;
  });

  it("runs one tool round-trip and returns the final answer", async () => {
    const fake = createFakeProvider({
      id: "fake",
      script: [
        {
          text: "",
          toolCalls: [{ id: "c1", name: "get_weather", arguments: { city: "Paris" } }],
          stopReason: "tool_use",
        },
        // Second turn: the tool result must be present before the model answers.
        (messages) => {
          const last = messages.at(-1)!;
          expect(last.role).toBe("tool");
          expect(last.content).toContain("18C and sunny in Paris");
          return { text: "Wear sunglasses — it's sunny in Paris.", stopReason: "end_turn" };
        },
      ],
    });
    registerProvider(fake);

    const res = await runFlow(buildFlow(["get_weather"]), {
      input: { city: "Paris" },
    });

    expect(res.status).toBe("completed");
    expect(res.output).toBe("Wear sunglasses — it's sunny in Paris.");
    expect(toolInvocations).toEqual([
      { name: "get_weather", args: { city: "Paris" } },
    ]);
    // Two model turns: the tool request and the final answer.
    expect(fake.calls.length).toBe(2);
  });

  it("chains two tools across three model turns", async () => {
    registerProvider(
      createFakeProvider({
        id: "fake",
        script: [
          {
            text: "",
            toolCalls: [{ id: "c1", name: "get_weather", arguments: { city: "Rome" } }],
            stopReason: "tool_use",
          },
          {
            text: "",
            toolCalls: [
              { id: "c2", name: "suggest_outfit", arguments: { conditions: "sunny" } },
            ],
            stopReason: "tool_use",
          },
          { text: "It's sunny in Rome, so wear sunglasses.", stopReason: "end_turn" },
        ],
      }),
    );

    const res = await runFlow(buildFlow(["get_weather", "suggest_outfit"]), {
      input: { city: "Rome" },
    });

    expect(res.status).toBe("completed");
    expect(res.output).toBe("It's sunny in Rome, so wear sunglasses.");
    expect(toolInvocations.map((t) => t.name)).toEqual([
      "get_weather",
      "suggest_outfit",
    ]);
    expect(toolInvocations[1]!.args).toEqual({ conditions: "sunny" });
  });

  it("advertises the configured tool specs to the provider", async () => {
    const fake = createFakeProvider({
      id: "fake",
      script: [{ text: "no tools needed", stopReason: "end_turn" }],
    });
    registerProvider(fake);

    await runFlow(buildFlow(["get_weather"]), { input: { city: "Oslo" } });

    const advertised = fake.calls[0]!.options.tools as ToolSpec[];
    expect(advertised.map((t) => t.name)).toEqual(["get_weather"]);
    // The interpolated prompt reached the model.
    expect(fake.calls[0]!.messages.at(-1)!.content).toBe("What should I wear in Oslo?");
  });

  it("stops the loop at maxSteps instead of spinning forever", async () => {
    // A provider that never stops asking for the tool.
    let n = 0;
    const looping: ModelProvider = {
      id: "fake",
      async chat(_messages, opts = {}) {
        opts.onDelta?.("");
        return {
          text: "",
          toolCalls: [
            { id: `c${n++}`, name: "get_weather", arguments: { city: "Loop" } },
          ],
          stopReason: "tool_use",
        };
      },
    };
    registerProvider(looping);

    const res = await runFlow(buildFlow(["get_weather"], 3), {
      input: { city: "Loop" },
    });

    expect(res.status).toBe("completed");
    expect(toolInvocations.length).toBe(3);
  });
});
