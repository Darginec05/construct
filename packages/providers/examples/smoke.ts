import assert from "node:assert/strict";
import { buildParams, fromMessage } from "../dist/anthropic.js";
import type { ChatMessage } from "../dist/index.js";

function main(): void {
  // buildParams: a prompt with an advertised tool.
  const p1 = buildParams(
    [
      { role: "system", content: "be terse" },
      { role: "user", content: "look up 7" },
    ],
    {
      model: "claude-haiku-4-5-20251001",
      temperature: 0.2,
      tools: [
        {
          name: "lookup",
          description: "Look up a record",
          parameters: { type: "object", properties: { id: { type: "number" } } },
        },
      ],
      toolChoice: "auto",
    },
    1024,
  );
  assert.equal(p1.system, "be terse", "system hoisted to top level");
  assert.equal(p1.max_tokens, 1024, "default max_tokens applied");
  assert.equal(p1.temperature, 0.2);
  assert.equal((p1.tools as any)[0].input_schema.type, "object", "tool schema mapped");
  assert.deepEqual(p1.tool_choice, { type: "auto" }, "toolChoice mapped");
  assert.deepEqual(
    p1.messages,
    [{ role: "user", content: "look up 7" }],
    "system stripped from messages",
  );

  // buildParams: a tool round-trip groups adjacent tool results into one turn.
  const convo: ChatMessage[] = [
    { role: "user", content: "look up 7" },
    {
      role: "assistant",
      content: "let me check",
      toolCalls: [{ id: "tu_1", name: "lookup", arguments: { id: 7 } }],
    },
    { role: "tool", toolCallId: "tu_1", content: "record#7" },
    { role: "tool", toolCallId: "tu_1", content: "extra" },
  ];
  const p2 = buildParams(convo, { model: "m", maxTokens: 256 }, 1024);
  assert.equal(p2.max_tokens, 256, "explicit maxTokens wins over default");
  const assistant = p2.messages[1]!;
  assert.ok(Array.isArray(assistant.content));
  assert.equal((assistant.content as any)[0].type, "text");
  assert.equal((assistant.content as any)[1].type, "tool_use");
  const toolTurn = p2.messages[2]!;
  assert.equal(toolTurn.role, "user", "tool results land in a user turn");
  assert.equal((toolTurn.content as any).length, 2, "adjacent tool results grouped");
  assert.equal(p2.tools, undefined, "no tools advertised when none passed");

  // fromMessage: assemble text, tool calls, stop reason, and usage.
  const result = fromMessage({
    content: [
      { type: "text", text: "hi" },
      { type: "tool_use", id: "t1", name: "lookup", input: { id: 7 } },
    ],
    stop_reason: "tool_use",
    usage: { input_tokens: 10, output_tokens: 5 },
  } as Parameters<typeof fromMessage>[0]);
  assert.equal(result.text, "hi");
  assert.deepEqual(result.toolCalls, [
    { id: "t1", name: "lookup", arguments: { id: 7 } },
  ]);
  assert.equal(result.stopReason, "tool_use");
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 5 });

  console.log("providers smoke: all assertions passed");
  console.log("  params ->", JSON.stringify({ system: p1.system, tool_choice: p1.tool_choice }));
  console.log("  result ->", JSON.stringify(result));
}

main();
