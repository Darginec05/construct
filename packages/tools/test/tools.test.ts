import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineTool,
  getTool,
  higherTier,
  listTools,
  needsApproval,
  registerTool,
  runTool,
  type Tool,
} from "../src/index.js";

describe("defineTool", () => {
  it("derives parameters from the zod input schema", () => {
    const tool = defineTool({
      name: "greet",
      description: "Greet someone",
      input: z.object({ name: z.string() }),
      run: ({ name }) => `hi ${name}`,
    });
    expect(tool.parameters).toEqual({
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    });
  });

  it("validates and parses raw input before run", async () => {
    const tool = defineTool({
      name: "double",
      description: "Double a number",
      input: z.object({ n: z.number() }),
      run: ({ n }) => n * 2,
    });
    expect(tool.run({ n: 21 })).toBe(42);
    expect(() => tool.run({ n: "nope" })).toThrow();
  });

  it("honors explicit parameters override", () => {
    const custom = { type: "object", properties: { x: { type: "string" } } };
    const tool = defineTool({
      name: "raw",
      description: "Raw passthrough",
      parameters: custom,
      run: (input) => input,
    });
    expect(tool.parameters).toBe(custom);
  });

  it("defaults parameters to an open object without a schema", () => {
    const tool = defineTool({
      name: "anything",
      description: "Takes anything",
      run: (input) => input,
    });
    expect(tool.parameters).toEqual({ type: "object", properties: {} });
  });

  it("carries tier and requiresApproval through", () => {
    const tool = defineTool({
      name: "rm",
      description: "Dangerous",
      tier: "dangerous",
      requiresApproval: true,
      run: () => "done",
    });
    expect(tool.tier).toBe("dangerous");
    expect(tool.requiresApproval).toBe(true);
  });
});

describe("runTool", () => {
  it("returns ok with the output on success", async () => {
    const tool: Tool = {
      name: "ok",
      description: "",
      run: () => ({ value: 1 }),
    };
    expect(await runTool(tool, {})).toEqual({ ok: true, output: { value: 1 } });
  });

  it("returns an error instead of throwing", async () => {
    const tool: Tool = {
      name: "boom",
      description: "",
      run: () => {
        throw new Error("kaboom");
      },
    };
    expect(await runTool(tool, {})).toEqual({ ok: false, error: "kaboom" });
  });

  it("times out a hung tool", async () => {
    const tool: Tool = {
      name: "hang",
      description: "",
      run: () => new Promise(() => {}),
    };
    const result = await runTool(tool, {}, { timeoutMs: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/timed out/);
  });
});

describe("needsApproval", () => {
  it("does not gate read/content or untiered tools", () => {
    expect(needsApproval({ tier: "read" })).toBe(false);
    expect(needsApproval({ tier: "content" })).toBe(false);
    expect(needsApproval({})).toBe(false);
  });

  it("gates write/bulk/dangerous tiers by default", () => {
    expect(needsApproval({ tier: "write" })).toBe(true);
    expect(needsApproval({ tier: "bulk" })).toBe(true);
    expect(needsApproval({ tier: "dangerous" })).toBe(true);
  });

  it("gates any tool that opts in via requiresApproval", () => {
    expect(needsApproval({ tier: "read", requiresApproval: true })).toBe(true);
    expect(needsApproval({ requiresApproval: true })).toBe(true);
  });

  it("honors a custom gated-tier set", () => {
    expect(needsApproval({ tier: "content" }, ["content"])).toBe(true);
    expect(needsApproval({ tier: "write" }, ["content"])).toBe(false);
  });
});

describe("higherTier", () => {
  it("returns the more dangerous of two tiers", () => {
    expect(higherTier("read", "dangerous")).toBe("dangerous");
    expect(higherTier("dangerous", "read")).toBe("dangerous");
    expect(higherTier("write", "bulk")).toBe("bulk");
  });

  it("treats undefined as the lowest risk", () => {
    expect(higherTier(undefined, "write")).toBe("write");
    expect(higherTier("write", undefined)).toBe("write");
    expect(higherTier(undefined, undefined)).toBeUndefined();
  });

  it("escalates an untiered tool but never relaxes a gated one", () => {
    // A node tier can raise a read tool to a gated tier...
    expect(needsApproval({ tier: higherTier("dangerous", "read") })).toBe(true);
    // ...but cannot downgrade an intrinsically dangerous tool.
    expect(needsApproval({ tier: higherTier("read", "dangerous") })).toBe(true);
  });
});

describe("registry", () => {
  it("registers and retrieves tools by name", () => {
    const tool = defineTool({
      name: "registry-probe",
      description: "",
      run: () => "x",
    });
    registerTool(tool);
    expect(getTool("registry-probe")).toBe(tool);
    expect(listTools()).toContain(tool);
  });
});
