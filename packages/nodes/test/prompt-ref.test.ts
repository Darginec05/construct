import { SCHEMA_VERSION, type Flow } from "@construct/dsl";
import { runFlow } from "@construct/engine";
import { createFakeProvider, registerProvider, type ChatMessage } from "@construct/providers";
import { describe, expect, it } from "vitest";
// Importing the package registers the real `agent` executor we exercise here.
import "../src/index.js";

/**
 * Registry prompt references: an agent's `system` / `prompt` may be a PromptRef
 * resolved at runtime from `RunOptions.prompts`, with declared `vars` bound
 * against run state and interpolated into the template body. Only the model is
 * faked; the engine resolution path is real.
 */

function flowWith(config: Record<string, unknown>): Flow {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "a",
    name: "a",
    channels: [
      { name: "topic", type: "text", reducer: "lastValue" },
      { name: "out", type: "text", reducer: "lastValue" },
    ],
    resources: [],
    nodes: [
      { id: "in", type: "input", config: { schema: { topic: "text" } } },
      {
        id: "agent",
        type: "agent",
        config: { model: { provider: "fake", model: "m" }, writeTo: "out", ...config },
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

function captureProvider(): { seen: ChatMessage[][] } {
  const seen: ChatMessage[][] = [];
  registerProvider(
    createFakeProvider({
      id: "fake",
      script: [
        (messages): { text: string; stopReason: "end_turn" } => {
          seen.push(messages);
          return { text: "ok", stopReason: "end_turn" };
        },
      ],
    }),
  );
  return { seen };
}

describe("agent prompt refs", () => {
  it("resolves a system PromptRef and binds its vars against run state", async () => {
    const { seen } = captureProvider();

    const res = await runFlow(
      flowWith({
        system: { ref: "reviewer", vars: { focus: "$.topic" } },
        prompt: "review this",
      }),
      {
        input: { topic: "security" },
        prompts: { reviewer: "You are a reviewer. Focus on {{focus}}." },
      },
    );

    expect(res.status).toBe("completed");
    const messages = seen[0]!;
    expect(messages[0]).toEqual({
      role: "system",
      content: "You are a reviewer. Focus on security.",
    });
    expect(messages[1]).toEqual({ role: "user", content: "review this" });
  });

  it("joins an array of system parts (registry persona + inline addendum)", async () => {
    const { seen } = captureProvider();

    const res = await runFlow(
      flowWith({
        system: [{ ref: "persona" }, "Be concise."],
        prompt: "hi",
      }),
      { input: { topic: "x" }, prompts: { persona: "You are helpful." } },
    );

    expect(res.status).toBe("completed");
    expect(seen[0]![0]).toEqual({
      role: "system",
      content: "You are helpful.\n\nBe concise.",
    });
  });

  it("resolves a PromptRef in the user prompt position", async () => {
    const { seen } = captureProvider();

    const res = await runFlow(
      flowWith({ prompt: { ref: "ask", vars: { subject: "$.topic" } } }),
      { input: { topic: "billing" }, prompts: { ask: "Explain {{subject}}." } },
    );

    expect(res.status).toBe("completed");
    expect(seen[0]![0]).toEqual({ role: "user", content: "Explain billing." });
  });

  it("fails the run when a referenced prompt is not provided", async () => {
    captureProvider();

    const res = await runFlow(flowWith({ system: { ref: "missing" }, prompt: "go" }), {
      input: { topic: "x" },
    });

    expect(res.status).toBe("failed");
    expect(res.error).toContain("missing");
  });
});
