import { describe, expect, it } from "vitest";
import { defineFlow, defineNode } from "../src/flow.js";
import { isFlowRef, isNodeDef } from "../src/types.js";

describe("isFlowRef", () => {
  it("recognizes FlowDefinition instances", () => {
    const flow = defineFlow("x", "X", (f) => {
      const out = f.text("out");
      f.input().to(f.output(out));
    });
    expect(isFlowRef(flow)).toBe(true);
    expect(isFlowRef({ __kind: "flow", id: "x", toJSON: () => ({}) })).toBe(true);
    expect(isFlowRef(null)).toBe(false);
    expect(isFlowRef({ id: "x" })).toBe(false);
  });
});

describe("isNodeDef", () => {
  it("recognizes defineNode results", () => {
    const node = defineNode({ id: "noop", run: () => null });
    expect(isNodeDef(node)).toBe(true);
    expect(isNodeDef({ __kind: "node-def", id: "n", run: async () => null })).toBe(true);
    expect(isNodeDef("noop")).toBe(false);
  });
});
