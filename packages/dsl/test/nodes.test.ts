import { describe, expect, it } from "vitest";
import {
  BUILTIN_NODE_TYPES,
  getNodeSpec,
  listNodeSpecs,
  registerNodeSpec,
  resolveNodeOutputs,
} from "../src/index.js";

describe("catalog registry", () => {
  it("ships the full built-in catalog", () => {
    const types = listNodeSpecs().map((s) => s.type);
    for (const t of [
      "input",
      "output",
      "agent",
      "router",
      "branch",
      "switch",
      "loop",
      "map",
      "join",
      "code",
      "retrieve",
      "transform",
      "tool",
      "human",
      "subflow",
    ]) {
      expect(types).toContain(t);
    }
  });

  it("exposes BUILTIN_NODE_TYPES matching the specs", () => {
    expect(new Set(BUILTIN_NODE_TYPES)).toEqual(
      new Set(listNodeSpecs().map((s) => s.type)),
    );
  });

  it("returns undefined for unknown types", () => {
    expect(getNodeSpec("does-not-exist")).toBeUndefined();
  });

  it("tags each built-in with a known category", () => {
    const cats = new Set([
      "io",
      "model",
      "control",
      "data",
      "tool",
      "human",
      "composite",
    ]);
    for (const spec of listNodeSpecs()) {
      expect(cats.has(spec.category)).toBe(true);
    }
  });
});

describe("registerNodeSpec", () => {
  const PLUGIN = "test-plugin-node";

  it("registers a plugin spec discoverable via getNodeSpec", () => {
    registerNodeSpec({
      type: PLUGIN,
      category: "tool",
      description: "test plugin",
      configSchema: getNodeSpec("transform")!.configSchema,
      outputs: ["out", "alt"],
    });
    const spec = getNodeSpec(PLUGIN);
    expect(spec?.outputs).toEqual(["out", "alt"]);
    expect(resolveNodeOutputs(PLUGIN, {})).toEqual(["out", "alt"]);
  });
});

describe("config schemas", () => {
  it("applies agent defaults", () => {
    const cfg = getNodeSpec("agent")!.configSchema.parse({
      model: { provider: "anthropic", model: "x" },
    });
    expect(cfg).toMatchObject({
      tools: [],
      toolChoice: "auto",
      maxSteps: 8,
      output: "text",
    });
  });

  it("requires a model on agent", () => {
    expect(getNodeSpec("agent")!.configSchema.safeParse({}).success).toBe(
      false,
    );
  });

  it("applies tool defaults", () => {
    const cfg = getNodeSpec("tool")!.configSchema.parse({ tool: "search" });
    expect(cfg).toMatchObject({ args: {}, requiresApproval: false });
  });

  it("requires either ref or inline on code", () => {
    const schema = getNodeSpec("code")!.configSchema;
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ ref: "fn" }).success).toBe(true);
    expect(schema.safeParse({ inline: "return 1" }).success).toBe(true);
  });

  it("requires at least one router class", () => {
    const schema = getNodeSpec("router")!.configSchema;
    expect(
      schema.safeParse({
        model: { provider: "a", model: "x" },
        classes: [],
      }).success,
    ).toBe(false);
  });

  it("requires each router class to have a name", () => {
    const schema = getNodeSpec("router")!.configSchema;
    expect(
      schema.safeParse({
        model: { provider: "a", model: "x" },
        classes: [{ description: "no name" }],
      }).success,
    ).toBe(false);
  });
});

describe("resolveNodeOutputs", () => {
  it("returns static outputs for fixed-handle nodes", () => {
    expect(resolveNodeOutputs("branch", {})).toEqual(["true", "false"]);
    expect(resolveNodeOutputs("agent", {})).toEqual(["out"]);
    expect(resolveNodeOutputs("output", {})).toEqual([]);
  });

  it("expands router class names into handles", () => {
    expect(
      resolveNodeOutputs("router", {
        classes: [{ name: "billing" }, { name: "support" }],
      }),
    ).toEqual(["billing", "support"]);
  });

  it("appends a fallback handle when router fallback is on", () => {
    expect(
      resolveNodeOutputs("router", {
        classes: [{ name: "billing" }, { name: "support" }],
        fallback: true,
      }),
    ).toEqual(["billing", "support", "fallback"]);
  });

  it("appends default to switch cases", () => {
    expect(resolveNodeOutputs("switch", { cases: ["a", "b"] })).toEqual([
      "a",
      "b",
      "default",
    ]);
  });

  it("derives human handles from mode", () => {
    expect(resolveNodeOutputs("human", { mode: "approve" })).toEqual([
      "approved",
      "rejected",
    ]);
    expect(resolveNodeOutputs("human", { mode: "select" })).toEqual(["next"]);
    expect(resolveNodeOutputs("human", { mode: "collect" })).toEqual(["next"]);
  });

  it("lets human exits override the mode default", () => {
    expect(
      resolveNodeOutputs("human", {
        mode: "approve",
        exits: ["approved", "changes", "rejected"],
      }),
    ).toEqual(["approved", "changes", "rejected"]);
  });

  it("returns [] for unknown node types", () => {
    expect(resolveNodeOutputs("nope", {})).toEqual([]);
  });
});
