import assert from "node:assert/strict";
import { SCHEMA_VERSION, type Flow } from "@construct/dsl";
import { runFlow } from "@construct/engine";
import {
  registerProvider,
  type ChatMessage,
  type ChatResult,
} from "@construct/providers";
import { registerTool } from "@construct/tools";
import "../dist/index.js"; // registers agent / classifier / tool executors

function userText(messages: ChatMessage[]): string {
  const m = messages.find((x) => x.role === "user");
  return m && "content" in m ? m.content : "";
}

/** A deterministic fake model so the wiring can be tested offline. */
registerProvider({
  id: "fake",
  async chat(messages: ChatMessage[]): Promise<ChatResult> {
    const system =
      messages.find((m) => m.role === "system")?.content ?? "";
    if (system.startsWith("Classify")) return { text: "billing" };
    return { text: `ok:${userText(messages)}` };
  },
});

/**
 * A fake model that drives one tool round-trip: first turn it asks to call the
 * `lookup` tool, then on seeing the tool result it produces the final answer.
 */
let toolModelTurn = 0;
registerProvider({
  id: "tool-model",
  async chat(messages: ChatMessage[]): Promise<ChatResult> {
    const toolResult = messages.find((m) => m.role === "tool");
    if (!toolResult) {
      toolModelTurn++;
      return {
        text: "",
        toolCalls: [{ id: "c1", name: "lookup", arguments: { id: 7 } }],
      };
    }
    return { text: `answer:${toolResult.content}` };
  },
});

let lookupCalls = 0;
registerTool({
  name: "lookup",
  description: "Look up a record by id",
  parameters: { type: "object", properties: { id: { type: "number" } } },
  async run(input: unknown): Promise<string> {
    lookupCalls++;
    const id = (input as { id?: number }).id ?? 0;
    return `record#${id}`;
  },
});

const flow: Flow = {
  schemaVersion: SCHEMA_VERSION,
  id: "support-router",
  name: "classify then answer",
  channels: [
    { name: "q", type: "text", reducer: "lastValue" },
    { name: "intent", type: "text", reducer: "lastValue" },
    { name: "answer", type: "text", reducer: "lastValue" },
  ],
  resources: [],
  nodes: [
    { id: "in", type: "input", config: { schema: { q: "text" } } },
    {
      id: "route",
      type: "classifier",
      config: {
        model: { provider: "fake", model: "m" },
        prompt: "{{q}}",
        classes: ["billing", "support"],
        writeTo: "intent",
      },
    },
    {
      id: "billing",
      type: "agent",
      config: {
        model: { provider: "fake", model: "m" },
        prompt: "billing: {{q}}",
        writeTo: "answer",
      },
    },
    {
      id: "support",
      type: "agent",
      config: {
        model: { provider: "fake", model: "m" },
        prompt: "support: {{q}}",
        writeTo: "answer",
      },
    },
    { id: "out", type: "output", config: { from: "$.answer" } },
  ],
  edges: [
    { id: "e1", source: "in", target: "route" },
    { id: "e2", source: "route", target: "billing", sourceHandle: "billing" },
    { id: "e3", source: "route", target: "support", sourceHandle: "support" },
    { id: "e4", source: "billing", target: "out" },
    { id: "e5", source: "support", target: "out" },
  ],
  config: {},
  metadata: {},
};

// An agent that must call a tool, read its result, then answer.
const toolFlow: Flow = {
  schemaVersion: SCHEMA_VERSION,
  id: "agent-tool",
  name: "tool-use loop",
  channels: [{ name: "answer", type: "text", reducer: "lastValue" }],
  resources: [],
  nodes: [
    { id: "in", type: "input", config: {} },
    {
      id: "act",
      type: "agent",
      config: {
        model: { provider: "tool-model", model: "m" },
        prompt: "do it",
        tools: ["lookup"],
        writeTo: "answer",
      },
    },
    { id: "out", type: "output", config: { from: "$.answer" } },
  ],
  edges: [
    { id: "e1", source: "in", target: "act" },
    { id: "e2", source: "act", target: "out" },
  ],
  config: {},
  metadata: {},
};

async function main(): Promise<void> {
  const res = await runFlow(flow, { input: { q: "charge me twice?" } });
  assert.equal(res.status, "completed");
  assert.equal(res.state.intent, "billing", "classifier sets intent + handle");
  assert.equal(res.output, "ok:billing: charge me twice?", "billing branch ran");

  const loop = await runFlow(toolFlow, { input: {} });
  assert.equal(loop.status, "completed");
  assert.equal(lookupCalls, 1, "agent executed the tool once");
  assert.equal(toolModelTurn, 1, "model asked for the tool on the first turn");
  assert.equal(
    loop.output,
    "answer:record#7",
    "model answered from the tool result",
  );

  console.log("nodes smoke: all assertions passed");
  console.log("  state ->", JSON.stringify(res.state));
  console.log("  output ->", res.output);
  console.log("  loop   ->", loop.output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
