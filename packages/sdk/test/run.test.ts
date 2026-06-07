import { createFakeProvider, registerProvider } from "@construct/providers";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineNode, provider } from "../src/index.js";

beforeAll(() => {
  registerProvider(createFakeProvider({ id: "fake" }));
});

describe("FlowDefinition.run", () => {
  it("runs an agent flow end-to-end via the fake provider", async () => {
    const echo = defineFlow("echo", "Echo", (f) => {
      const message = f.text("message");
      const reply = f.text("reply");
      f.input({ channel: message })
        .agent({ model: provider("fake", "m"), prompt: message, writeTo: reply })
        .to(f.output(reply));
    });

    const result = await echo.run({ message: "hello" });
    expect(result.status).toBe("completed");
    expect(result.output).toBe("hello");
  });

  it("registers a defineNode code handler and runs it", async () => {
    const double = defineNode({
      id: "double",
      input: z.object({ x: z.number() }),
      run: ({ x }) => x * 2,
    });

    const flow = defineFlow("calc", "Calc", (f) => {
      const x = f.json("x");
      const y = f.json("y");
      f.input({ channel: x }).code(double, { writeTo: y }).to(f.output(y));
    });

    const result = await flow.run({ x: 21 });
    expect(result.status).toBe("completed");
    expect(result.output).toBe(42);
  });

  it("bundles a subflow body so a map can run it", async () => {
    const item = defineFlow("item", "Item", (f) => {
      const v = f.json("v");
      f.input({ channel: v }).to(f.output(v));
    });

    const flow = defineFlow("fanout", "Fanout", (f) => {
      const items = f.json("items");
      const collected = f.json("collected", { reducer: "append" });
      f.input({ channel: items })
        .map({ over: items, body: item, writeTo: collected })
        .to(f.output(collected));
    });

    const result = await flow.run({ items: [1, 2, 3] });
    expect(result.status).toBe("completed");
  });
});
