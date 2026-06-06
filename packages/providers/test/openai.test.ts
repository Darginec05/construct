import { describe, expect, it } from "vitest";
import { buildParams, fromCompletion } from "../src/openai.js";
import type { ChatMessage } from "../src/index.js";

describe("openai buildParams", () => {
  it("keeps system messages in the message list", () => {
    const params = buildParams(
      [
        { role: "system", content: "be terse" },
        { role: "user", content: "hi" },
      ],
      { model: "m" },
      1024,
    );
    expect(params.messages[0]).toEqual({ role: "system", content: "be terse" });
    expect(params.messages.length).toBe(2);
  });

  it("applies the default max_tokens, prefers explicit, omits when unset", () => {
    expect(buildParams([], { model: "m" }, 1024).max_tokens).toBe(1024);
    expect(buildParams([], { model: "m", maxTokens: 256 }, 1024).max_tokens).toBe(256);
    expect(buildParams([], { model: "m" }, undefined).max_tokens).toBeUndefined();
  });

  it("serializes tool-call arguments to a JSON string", () => {
    const params = buildParams(
      [
        {
          role: "assistant",
          content: "let me check",
          toolCalls: [{ id: "t1", name: "lookup", arguments: { id: 7 } }],
        },
      ],
      { model: "m" },
      1024,
    );
    const msg = params.messages[0] as any;
    expect(msg.tool_calls[0].id).toBe("t1");
    expect(msg.tool_calls[0].function.arguments).toBe(JSON.stringify({ id: 7 }));
  });

  it("uses null content for a purely tool-call assistant turn", () => {
    const params = buildParams(
      [
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "t1", name: "lookup", arguments: {} }],
        },
      ],
      { model: "m" },
      1024,
    );
    expect((params.messages[0] as any).content).toBeNull();
  });

  it("keeps one tool message per result, not grouped", () => {
    const convo: ChatMessage[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "t1", name: "lookup", arguments: {} }],
      },
      { role: "tool", toolCallId: "t1", content: "a" },
      { role: "tool", toolCallId: "t1", content: "b" },
    ];
    const params = buildParams(convo, { model: "m" }, 1024);
    expect(params.messages[1]).toEqual({
      role: "tool",
      tool_call_id: "t1",
      content: "a",
    });
    expect(params.messages[2]!.role).toBe("tool");
    expect(params.messages.length).toBe(3);
  });

  it("maps tool_choice to a bare string", () => {
    const tools = [{ name: "x", description: "d", parameters: { type: "object" } }];
    expect(buildParams([], { model: "m", tools, toolChoice: "required" }, 1024).tool_choice).toBe("required");
    expect(buildParams([], { model: "m", tools, toolChoice: "none" }, 1024).tool_choice).toBe("none");
    expect(buildParams([], { model: "m", tools }, 1024).tool_choice).toBe("auto");
  });
});

describe("openai fromCompletion", () => {
  it("assembles text, tool calls, finish reason, and usage", () => {
    const result = fromCompletion({
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
    expect(result.text).toBe("hi");
    expect(result.toolCalls).toEqual([
      { id: "t1", name: "lookup", arguments: { id: 7 } },
    ]);
    expect(result.stopReason).toBe("tool_calls");
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it("falls back to empty arguments on malformed JSON", () => {
    const result = fromCompletion({
      choices: [
        {
          index: 0,
          finish_reason: "length",
          logprobs: null,
          message: {
            role: "assistant",
            content: null,
            refusal: null,
            tool_calls: [
              {
                id: "t1",
                type: "function",
                function: { name: "lookup", arguments: '{"id":' },
              },
            ],
          },
        },
      ],
    } as Parameters<typeof fromCompletion>[0]);
    expect(result.text).toBe("");
    expect(result.toolCalls).toEqual([{ id: "t1", name: "lookup", arguments: {} }]);
  });
});
