import { describe, expect, it } from "vitest";
import { createFakeProvider } from "../src/fake.js";

describe("createFakeProvider", () => {
  it("replays scripted replies in order and records every call", async () => {
    const fake = createFakeProvider({
      script: [
        { text: "first", stopReason: "end_turn" },
        { text: "second", stopReason: "end_turn" },
      ],
    });
    const a = await fake.chat([{ role: "user", content: "1" }]);
    const b = await fake.chat([{ role: "user", content: "2" }]);
    expect(a.text).toBe("first");
    expect(b.text).toBe("second");
    expect(fake.calls.length).toBe(2);
    expect(fake.cursor).toBe(2);
    expect(fake.calls[0]!.messages[0]!.content).toBe("1");
  });

  it("passes messages and options into a function step", async () => {
    const fake = createFakeProvider({
      script: [
        (msgs, opts) => ({
          text: `${msgs.length} msgs at temp ${opts.temperature}`,
          stopReason: "end_turn",
        }),
      ],
    });
    const r = await fake.chat(
      [
        { role: "user", content: "a" },
        { role: "user", content: "b" },
      ],
      { temperature: 0.5 },
    );
    expect(r.text).toBe("2 msgs at temp 0.5");
  });

  it("returns tool calls so a runner can drive a tool loop", async () => {
    const fake = createFakeProvider({
      script: [
        {
          text: "",
          toolCalls: [{ id: "c1", name: "lookup", arguments: { id: 7 } }],
          stopReason: "tool_use",
        },
      ],
    });
    const r = await fake.chat([{ role: "user", content: "go" }]);
    expect(r.toolCalls).toEqual([
      { id: "c1", name: "lookup", arguments: { id: 7 } },
    ]);
  });

  it("echoes the last user message once the script is exhausted", async () => {
    const fake = createFakeProvider({ script: [{ text: "scripted" }] });
    await fake.chat([{ role: "user", content: "1" }]);
    const echo = await fake.chat([
      { role: "user", content: "ping" },
      { role: "assistant", content: "noise" },
    ]);
    expect(echo.text).toBe("ping");
    expect(echo.stopReason).toBe("end_turn");
  });

  it("forwards the reply text through onDelta", async () => {
    const fake = createFakeProvider({ script: [{ text: "hello" }] });
    let streamed = "";
    await fake.chat([{ role: "user", content: "x" }], {
      onDelta: (t) => {
        streamed += t;
      },
    });
    expect(streamed).toBe("hello");
  });

  it("defaults the provider id to fake and respects an override", () => {
    expect(createFakeProvider().id).toBe("fake");
    expect(createFakeProvider({ id: "mock" }).id).toBe("mock");
  });
});
