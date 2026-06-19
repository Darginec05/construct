import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineNode } from "../src/flow.js";

describe("FlowDefinition.toJSON", () => {
  it("returns a fresh copy on each call", () => {
    const flow = defineFlow("fresh", "Fresh", (f) => {
      const msg = f.text("msg");
      f.input({ channel: msg }).to(f.output(msg));
    });

    const a = flow.toJSON();
    const b = flow.toJSON();
    expect(a).not.toBe(b);
    expect(a.nodes).not.toBe(b.nodes);
    expect(a).toEqual(b);

    a.nodes.push({ id: "ghost", type: "noop", config: {} });
    expect(flow.toJSON().nodes).toHaveLength(2);
  });
});

describe("FlowDefinition.validate / assertValid", () => {
  it("validate returns no errors for a well-formed flow", () => {
    const flow = defineFlow("ok", "OK", (f) => {
      const out = f.text("out");
      f.input().to(f.output(out));
    });
    expect(flow.validate().filter((i) => i.level === "error")).toEqual([]);
  });

  it("assertValid returns this for chaining", () => {
    const flow = defineFlow("ok", "OK", (f) => {
      const out = f.text("out");
      f.input().to(f.output(out));
    });
    expect(flow.assertValid()).toBe(flow);
  });

  it("validate surfaces warnings for unknown channel references", () => {
    const flow = defineFlow("warn", "Warn", (f) => {
      const out = f.json("out");
      f.input()
        .transform({ expr: "$.missing", writeTo: out })
        .to(f.output(out));
    });
    expect(flow.validate().some((i) => i.message.includes("unknown variable"))).toBe(true);
    expect(() => flow.assertValid()).not.toThrow();
  });

  it("assertValid throws when the document has catalog errors", () => {
    const flow = defineFlow("ok", "OK", (f) => {
      const out = f.text("out");
      f.input().to(f.output(out));
    });
    const json = flow.toJSON();
    json.nodes.splice(1, 0, { id: "agent", type: "agent", config: {} });
    json.edges.push(
      { id: "e2", source: "input", target: "agent" },
      { id: "e3", source: "agent", target: "output" },
    );

    const original = flow.toJSON.bind(flow);
    flow.toJSON = () => json;
    expect(() => flow.assertValid()).toThrow(/invalid flow/);
    flow.toJSON = original;
  });
});

describe("FlowDefinition.collect", () => {
  it("flattens subflows with parent links, deduplicated", () => {
    const worker = defineFlow("worker", "Worker", (f) => {
      const t = f.text("t");
      f.input({ channel: t }).to(f.output(t));
    });
    const fix = defineFlow("fix", "Fix", (f) => {
      const t = f.text("t");
      f.input({ channel: t }).to(f.output(t));
    });

    const parent = defineFlow("parent", "Parent", (f) => {
      const items = f.json("items");
      const files = f.file("files", { reducer: "merge" });
      f.input({ channel: items })
        .map({ over: items, body: worker, writeTo: files })
        .loop({ body: fix, writeTo: files })
        .to(f.output(files));
    });

    const collected = parent.collect();
    expect(collected.map((c) => [c.flow.id, c.parent])).toEqual([
      ["parent", null],
      ["worker", "parent"],
      ["fix", "parent"],
    ]);

    // visiting the same subflow twice should not duplicate entries
    const shared = defineFlow("shared-body", "Shared", (f) => {
      const x = f.text("x");
      f.input({ channel: x }).to(f.output(x));
    });
    const fan = defineFlow("fan", "Fan", (f) => {
      const a = f.json("a");
      const b = f.json("b");
      f.input({ channel: a })
        .subflow(shared, { writeTo: a })
        .subflow(shared, { writeTo: b })
        .to(f.output(b));
    });
    const ids = fan.collect().map((c) => c.flow.id);
    expect(ids.filter((id) => id === "shared-body")).toHaveLength(1);
  });
});

describe("defineNode", () => {
  it("validates input and output schemas when run", async () => {
    const strict = defineNode({
      id: "strict",
      input: z.object({ n: z.number() }),
      output: z.object({ doubled: z.number() }),
      run: ({ n }) => ({ doubled: n * 2 }),
    });

    const ctx = (state: Record<string, unknown>) => ({
      config: {},
      state,
      evaluate: () => undefined,
      onDelta: () => {},
    });

    await expect(strict.run(ctx({ n: "x" }))).rejects.toThrow();
    await expect(strict.run(ctx({ n: 3 }))).resolves.toEqual({ doubled: 6 });
  });
});
