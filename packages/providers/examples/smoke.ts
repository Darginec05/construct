import assert from "node:assert/strict";
import { buildParams, fromMessage } from "../dist/anthropic.js";
import {
  buildParams as buildOpenAIParams,
  fromCompletion,
} from "../dist/openai.js";
import {
  buildParams as buildGeminiParams,
  fromResponse,
} from "../dist/gemini.js";
import { createFakeProvider } from "../dist/fake.js";
import type { ChatMessage } from "../dist/index.js";

async function main(): Promise<void> {
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

  // --- OpenAI -------------------------------------------------------------

  // buildParams: system stays a message; tool args become a JSON string.
  const o1 = buildOpenAIParams(
    [
      { role: "system", content: "be terse" },
      { role: "user", content: "look up 7" },
    ],
    {
      model: "gpt-4o-mini",
      temperature: 0.2,
      tools: [
        {
          name: "lookup",
          description: "Look up a record",
          parameters: { type: "object", properties: { id: { type: "number" } } },
        },
      ],
      toolChoice: "required",
    },
    1024,
  );
  assert.equal(o1.max_tokens, 1024, "default max_tokens applied");
  assert.equal(o1.temperature, 0.2);
  assert.equal(o1.tool_choice, "required", "toolChoice mapped to a bare string");
  assert.equal((o1.tools as any)[0].function.name, "lookup", "tool mapped");
  assert.equal(o1.messages[0]!.role, "system", "system kept as a message");
  assert.equal(o1.messages.length, 2, "system not stripped");

  // buildParams: a tool round-trip keeps one tool message per result.
  const o2 = buildOpenAIParams(convo, { model: "m" }, undefined);
  assert.equal(o2.max_tokens, undefined, "max_tokens omitted when no cap given");
  const oAssistant = o2.messages[1]! as any;
  assert.equal(oAssistant.tool_calls[0].id, "tu_1");
  assert.equal(
    oAssistant.tool_calls[0].function.arguments,
    JSON.stringify({ id: 7 }),
    "arguments serialized to a JSON string",
  );
  assert.equal(o2.messages[2]!.role, "tool", "tool results stay tool messages");
  assert.equal(o2.messages.length, 4, "results not grouped into one turn");

  // fromCompletion: assemble text, tool calls, finish reason, and usage.
  const oResult = fromCompletion({
    choices: [
      {
        index: 0,
        finish_reason: "tool_calls",
        logprobs: null,
        message: {
          role: "assistant",
          content: "hi",
          refusal: null,
          tool_calls: [
            {
              id: "t1",
              type: "function",
              function: { name: "lookup", arguments: '{"id":7}' },
            },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  } as Parameters<typeof fromCompletion>[0]);
  assert.equal(oResult.text, "hi");
  assert.deepEqual(oResult.toolCalls, [
    { id: "t1", name: "lookup", arguments: { id: 7 } },
  ]);
  assert.equal(oResult.stopReason, "tool_calls");
  assert.deepEqual(oResult.usage, { inputTokens: 10, outputTokens: 5 });

  // --- Gemini -------------------------------------------------------------

  // buildParams: system hoists to systemInstruction; assistant role is "model".
  const g1 = buildGeminiParams(
    [
      { role: "system", content: "be terse" },
      { role: "user", content: "look up 7" },
    ],
    {
      model: "gemini-2.0-flash",
      temperature: 0.2,
      tools: [
        {
          name: "lookup",
          description: "Look up a record",
          parameters: { type: "object", properties: { id: { type: "number" } } },
        },
      ],
      toolChoice: "required",
    },
    1024,
  );
  assert.equal(g1.config!.systemInstruction, "be terse", "system → systemInstruction");
  assert.equal(g1.config!.maxOutputTokens, 1024, "default max_tokens → maxOutputTokens");
  assert.equal(g1.config!.temperature, 0.2);
  assert.equal(
    (g1.config!.tools as any)[0].functionDeclarations[0].name,
    "lookup",
    "tool mapped to functionDeclaration",
  );
  assert.equal(
    (g1.config!.toolConfig as any).functionCallingConfig.mode,
    "ANY",
    "required → ANY mode",
  );
  assert.deepEqual(
    g1.contents,
    [{ role: "user", parts: [{ text: "look up 7" }] }],
    "system stripped from contents",
  );

  // buildParams: a tool round-trip recovers the function name and groups results.
  const g2 = buildGeminiParams(convo, { model: "m", maxTokens: 256 }, 1024);
  assert.equal(g2.config!.maxOutputTokens, 256, "explicit maxTokens wins over default");
  const gContents = g2.contents as any[];
  assert.equal(gContents[1].role, "model", "assistant role renamed to model");
  assert.equal(gContents[1].parts[0].text, "let me check");
  assert.equal(gContents[1].parts[1].functionCall.name, "lookup");
  const gToolTurn = gContents[2];
  assert.equal(gToolTurn.role, "user", "tool results land in a user turn");
  assert.equal(gToolTurn.parts.length, 2, "adjacent tool results grouped");
  assert.equal(
    gToolTurn.parts[0].functionResponse.name,
    "lookup",
    "function name recovered from the preceding model turn",
  );
  assert.deepEqual(
    gToolTurn.parts[0].functionResponse.response,
    { output: "record#7" },
    "non-JSON tool result wrapped under output",
  );

  // fromResponse: assemble text, tool calls, finish reason, and usage.
  const gResult = fromResponse({
    candidates: [
      {
        content: {
          role: "model",
          parts: [
            { text: "hi" },
            { functionCall: { name: "lookup", args: { id: 7 } } },
          ],
        },
        finishReason: "STOP",
      },
    ],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
  } as Parameters<typeof fromResponse>[0]);
  assert.equal(gResult.text, "hi");
  assert.equal(gResult.toolCalls!.length, 1);
  assert.equal(gResult.toolCalls![0]!.id, "call_0", "synthesized stable id when omitted");
  assert.equal(gResult.toolCalls![0]!.name, "lookup");
  assert.deepEqual(gResult.toolCalls![0]!.arguments, { id: 7 });
  assert.equal(gResult.stopReason, "STOP");
  assert.deepEqual(gResult.usage, { inputTokens: 10, outputTokens: 5 });

  // --- Fake (offline, for integration tests) ------------------------------

  // A scripted two-turn tool loop: first reply asks for a tool, second answers.
  const fake = createFakeProvider({
    id: "fake",
    script: [
      {
        text: "",
        toolCalls: [{ id: "c1", name: "lookup", arguments: { id: 7 } }],
        stopReason: "tool_use",
      },
      // Function step: assert the tool result was fed back, then answer.
      (msgs) => {
        const toolMsg = msgs[msgs.length - 1]!;
        assert.equal(toolMsg.role, "tool", "tool result fed back on turn 2");
        return { text: "the answer is 42", stopReason: "end_turn" };
      },
    ],
  });

  const turn1 = await fake.chat([{ role: "user", content: "look up 7" }], {});
  assert.deepEqual(turn1.toolCalls, [
    { id: "c1", name: "lookup", arguments: { id: 7 } },
  ]);
  const turn2 = await fake.chat(
    [
      { role: "user", content: "look up 7" },
      { role: "assistant", content: "", toolCalls: turn1.toolCalls },
      { role: "tool", toolCallId: "c1", content: "record#7" },
    ],
    {},
  );
  assert.equal(turn2.text, "the answer is 42");
  assert.equal(fake.calls.length, 2, "every call recorded");
  assert.equal(fake.cursor, 2, "both script steps consumed");

  // Exhausted script echoes the last user message; onDelta still fires.
  let streamed = "";
  const echo = await fake.chat([{ role: "user", content: "ping" }], {
    onDelta: (t) => {
      streamed += t;
    },
  });
  assert.equal(echo.text, "ping", "echoes last user message past the script");
  assert.equal(streamed, "ping", "onDelta forwarded the reply");

  console.log("providers smoke: all assertions passed");
  console.log("  params ->", JSON.stringify({ system: p1.system, tool_choice: p1.tool_choice }));
  console.log("  result ->", JSON.stringify(result));
  console.log("  openai ->", JSON.stringify(oResult));
  console.log("  gemini ->", JSON.stringify(gResult));
  console.log("  fake ->", JSON.stringify(turn2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
