import { describe, expect, it } from "vitest";
import { buildParams, fromMessage } from "../src/anthropic.js";
import type { ChatMessage } from "../src/index.js";

describe("anthropic buildParams", () => {
  it("hoists system messages to the top-level field, joined", () => {
    const params = buildParams(
      [
        { role: "system", content: "be terse" },
        { role: "system", content: "and kind" },
        { role: "user", content: "hi" },
      ],
      { model: "m" },
      1024,
    );
    expect(params.system).toBe("be terse\n\nand kind");
    expect(params.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("applies the default max_tokens and lets an explicit value win", () => {
    expect(buildParams([], { model: "m" }, 1024).max_tokens).toBe(1024);
    expect(buildParams([], { model: "m", maxTokens: 256 }, 1024).max_tokens).toBe(256);
  });

  it("throws when no model is given", () => {
    expect(() => buildParams([], {}, 1024)).toThrow(/missing "model"/);
  });

  it("emits a tool_use block array for an assistant turn with calls", () => {
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
    const blocks = params.messages[0]!.content as any[];
    expect(blocks[0]).toEqual({ type: "text", text: "let me check" });
    expect(blocks[1]).toEqual({
      type: "tool_use",
      id: "t1",
      name: "lookup",
      input: { id: 7 },
    });
  });

  it("keeps a text-only assistant turn as a plain string", () => {
    const params = buildParams(
      [{ role: "assistant", content: "done" }],
      { model: "m" },
      1024,
    );
    expect(params.messages[0]).toEqual({ role: "assistant", content: "done" });
  });

  it("groups adjacent tool results into one user turn", () => {
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
    const toolTurn = params.messages[1]!;
    expect(toolTurn.role).toBe("user");
    expect((toolTurn.content as any[]).length).toBe(2);
    expect((toolTurn.content as any[])[0]).toEqual({
      type: "tool_result",
      tool_use_id: "t1",
      content: "a",
    });
  });

  it("maps tools and tool_choice", () => {
    const params = buildParams(
      [],
      {
        model: "m",
        tools: [
          {
            name: "lookup",
            description: "d",
            parameters: { type: "object", properties: {} },
          },
        ],
        toolChoice: "required",
      },
      1024,
    );
    expect((params.tools as any)[0].input_schema.type).toBe("object");
    expect(params.tool_choice).toEqual({ type: "any" });
  });

  it("rejects a tool whose parameters are not a JSON Schema object", () => {
    expect(() =>
      buildParams(
        [],
        {
          model: "m",
          tools: [{ name: "bad", description: "d", parameters: { type: "string" } }],
        },
        1024,
      ),
    ).toThrow(/must be a JSON Schema object/);
  });

  it("omits tools when none are passed", () => {
    const params = buildParams([], { model: "m" }, 1024);
    expect(params.tools).toBeUndefined();
    expect(params.tool_choice).toBeUndefined();
  });
});

describe("anthropic fromMessage", () => {
  it("assembles text, tool calls, stop reason, and usage", () => {
    const result = fromMessage({
      content: [
        { type: "text", text: "hi" },
        { type: "tool_use", id: "t1", name: "lookup", input: { id: 7 } },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 5 },
    } as Parameters<typeof fromMessage>[0]);
    expect(result.text).toBe("hi");
    expect(result.toolCalls).toEqual([
      { id: "t1", name: "lookup", arguments: { id: 7 } },
    ]);
    expect(result.stopReason).toBe("tool_use");
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it("omits toolCalls when the message has none", () => {
    const result = fromMessage({
      content: [{ type: "text", text: "hi" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    } as Parameters<typeof fromMessage>[0]);
    expect(result.toolCalls).toBeUndefined();
  });
});
