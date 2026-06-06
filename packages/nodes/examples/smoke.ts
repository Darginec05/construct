import assert from "node:assert/strict";
import { SCHEMA_VERSION, type Flow } from "@construct/dsl";
import { runFlow } from "@construct/engine";
import {
  registerProvider,
  type ChatMessage,
  type ChatResult,
} from "@construct/providers";
import { registerTool } from "@construct/tools";
import { createMemoryStore, registerStore } from "@construct/rag";
import "../dist/index.js"; // registers agent / classifier / tool / retrieve executors

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

/** A model that never settles — always asks for the tool again. */
registerProvider({
  id: "loopy",
  async chat(): Promise<ChatResult> {
    return { text: "", toolCalls: [{ id: "c", name: "lookup", arguments: {} }] };
  },
});

/** A model that streams its answer in chunks via onDelta. */
registerProvider({
  id: "streamer",
  async chat(_messages, opts): Promise<ChatResult> {
    for (const chunk of ["he", "llo"]) opts?.onDelta?.(chunk);
    return { text: "hello" };
  },
});

registerStore(
  "kb",
  createMemoryStore([
    { id: "a", text: "billing invoices and refunds policy" },
    { id: "b", text: "password reset and login support" },
    { id: "c", text: "shipping and delivery times" },
  ]),
);

// A Cyrillic store proves the tokenizer is not ASCII-only.
registerStore(
  "kb-ru",
  createMemoryStore([
    { id: "ru-a", text: "политика возврата и счета по оплате" },
    { id: "ru-b", text: "сброс пароля и вход в аккаунт" },
  ]),
);

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

  // A non-terminating tool loop must surface as a failure, not empty output.
  const stuck: Flow = {
    ...toolFlow,
    id: "agent-stuck",
    nodes: [
      { id: "in", type: "input", config: {} },
      {
        id: "act",
        type: "agent",
        config: {
          model: { provider: "loopy", model: "m" },
          prompt: "go",
          tools: ["lookup"],
          maxSteps: 3,
          writeTo: "answer",
        },
      },
      { id: "out", type: "output", config: { from: "$.answer" } },
    ],
  };
  const stuckRes = await runFlow(stuck, { input: {} });
  assert.equal(stuckRes.status, "failed", "exhausted tool loop fails the run");
  assert.match(String(stuckRes.error), /maxSteps/, "error names the cap");

  // streamed text surfaces as token events for the streaming agent's node.
  const streaming: Flow = {
    ...toolFlow,
    id: "agent-stream",
    nodes: [
      { id: "in", type: "input", config: {} },
      {
        id: "act",
        type: "agent",
        config: {
          model: { provider: "streamer", model: "m" },
          prompt: "go",
          writeTo: "answer",
        },
      },
      { id: "out", type: "output", config: { from: "$.answer" } },
    ],
  };
  const tokens: string[] = [];
  const streamRes = await runFlow(streaming, {
    input: {},
    onEvent: (e) => {
      if (e.type === "token" && e.nodeId === "act") tokens.push(String(e.data));
    },
  });
  assert.equal(streamRes.status, "completed");
  assert.equal(streamRes.output, "hello", "final text still assembled");
  assert.deepEqual(tokens, ["he", "llo"], "deltas surfaced as token events");

  // retrieve pulls the most relevant docs from a registered store.
  const ragFlow: Flow = {
    schemaVersion: SCHEMA_VERSION,
    id: "rag",
    name: "retrieve top-k",
    channels: [
      { name: "q", type: "text", reducer: "lastValue" },
      { name: "docs", type: "json", reducer: "lastValue" },
    ],
    resources: [],
    nodes: [
      { id: "in", type: "input", config: { schema: { q: "text" } } },
      {
        id: "find",
        type: "retrieve",
        config: { store: "kb", query: "{{q}}", topK: 2, writeTo: "docs" },
      },
      { id: "out", type: "output", config: { from: "$.docs" } },
    ],
    edges: [
      { id: "e1", source: "in", target: "find" },
      { id: "e2", source: "find", target: "out" },
    ],
    config: {},
    metadata: {},
  };
  const ragRes = await runFlow(ragFlow, { input: { q: "billing invoices refunds" } });
  assert.equal(ragRes.status, "completed");
  const docs = ragRes.state.docs as Array<{ id: string; score: number }>;
  assert.ok(docs.length >= 1 && docs.length <= 2, "respects topK");
  assert.equal(docs[0]!.id, "a", "billing doc ranked first for a billing query");

  // Cyrillic retrieval must not collapse to zero hits.
  const ruRes = await runFlow(
    { ...ragFlow, id: "rag-ru", nodes: ragFlow.nodes.map((n) =>
        n.id === "find"
          ? { ...n, config: { ...n.config, store: "kb-ru" } }
          : n,
      ) },
    { input: { q: "возврата счета оплате" } },
  );
  assert.equal(ruRes.status, "completed");
  const ruDocs = ruRes.state.docs as Array<{ id: string }>;
  assert.equal(ruDocs[0]!.id, "ru-a", "Cyrillic query retrieves the matching doc");

  console.log("nodes smoke: all assertions passed");
  console.log("  state ->", JSON.stringify(res.state));
  console.log("  output ->", res.output);
  console.log("  loop   ->", loop.output);
  console.log("  stream ->", tokens.join(""));
  console.log("  rag    ->", JSON.stringify(docs.map((d) => d.id)));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
