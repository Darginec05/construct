import { describe, expect, it } from "vitest";
import { buildParams, fromResponse } from "../src/gemini.js";
import type { ChatMessage } from "../src/index.js";

describe("gemini buildParams", () => {
  it("hoists system messages to config.systemInstruction, joined", () => {
    const params = buildParams(
      [
        { role: "system", content: "be terse" },
        { role: "system", content: "and kind" },
        { role: "user", content: "hi" },
      ],
      { model: "m" },
    );
    expect(params.config!.systemInstruction).toBe("be terse\n\nand kind");
    expect(params.contents).toEqual([{ role: "user", parts: [{ text: "hi" }] }]);
  });

  it("maps maxTokens to maxOutputTokens, preferring explicit over default", () => {
    expect(buildParams([], { model: "m" }, 1024).config!.maxOutputTokens).toBe(1024);
    expect(buildParams([], { model: "m", maxTokens: 256 }, 1024).config!.maxOutputTokens).toBe(256);
    expect(buildParams([], { model: "m" }).config!.maxOutputTokens).toBeUndefined();
  });

  it("renames the assistant role to model and emits functionCall parts", () => {
    const params = buildParams(
      [
        {
          role: "assistant",
          content: "let me check",
          toolCalls: [{ id: "t1", name: "lookup", arguments: { id: 7 } }],
        },
      ],
      { model: "m" },
    );
    const turn = params.contents![0] as any;
    expect(turn.role).toBe("model");
    expect(turn.parts[0]).toEqual({ text: "let me check" });
    expect(turn.parts[1].functionCall).toEqual({
      id: "t1",
      name: "lookup",
      args: { id: 7 },
    });
  });

  it("recovers the function name for a tool result and groups results", () => {
    const convo: ChatMessage[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "t1", name: "lookup", arguments: {} }],
      },
      { role: "tool", toolCallId: "t1", content: "record#7" },
      { role: "tool", toolCallId: "t1", content: "extra" },
    ];
    const params = buildParams(convo, { model: "m" });
    const toolTurn = params.contents![1] as any;
    expect(toolTurn.role).toBe("user");
    expect(toolTurn.parts.length).toBe(2);
    expect(toolTurn.parts[0].functionResponse.name).toBe("lookup");
  });

  it("wraps a non-JSON tool result under an output key", () => {
    const convo: ChatMessage[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "t1", name: "lookup", arguments: {} }],
      },
      { role: "tool", toolCallId: "t1", content: "plain text" },
    ];
    const params = buildParams(convo, { model: "m" });
    const part = (params.contents![1] as any).parts[0];
    expect(part.functionResponse.response).toEqual({ output: "plain text" });
  });

  it("passes through a JSON-object tool result unwrapped", () => {
    const convo: ChatMessage[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "t1", name: "lookup", arguments: {} }],
      },
      { role: "tool", toolCallId: "t1", content: '{"value":7}' },
    ];
    const params = buildParams(convo, { model: "m" });
    const part = (params.contents![1] as any).parts[0];
    expect(part.functionResponse.response).toEqual({ value: 7 });
  });

  it("maps tools and the function-calling mode", () => {
    const params = buildParams(
      [],
      {
        model: "m",
        tools: [{ name: "lookup", description: "d", parameters: { type: "object" } }],
        toolChoice: "required",
      },
    );
    expect((params.config!.tools as any)[0].functionDeclarations[0].name).toBe("lookup");
    expect((params.config!.toolConfig as any).functionCallingConfig.mode).toBe("ANY");
  });
});

describe("gemini fromResponse", () => {
  it("assembles text, tool calls, finish reason, and usage", () => {
    const result = fromResponse({
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              { text: "hi" },
              { functionCall: { id: "fc1", name: "lookup", args: { id: 7 } } },
            ],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    } as Parameters<typeof fromResponse>[0]);
    expect(result.text).toBe("hi");
    expect(result.toolCalls).toEqual([
      { id: "fc1", name: "lookup", arguments: { id: 7 } },
    ]);
    expect(result.stopReason).toBe("STOP");
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it("synthesizes stable ids when Gemini omits them", () => {
    const result = fromResponse({
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              { functionCall: { name: "a", args: {} } },
              { functionCall: { name: "b", args: {} } },
            ],
          },
        },
      ],
    } as Parameters<typeof fromResponse>[0]);
    expect(result.toolCalls!.map((c) => c.id)).toEqual(["call_0", "call_1"]);
  });
});
