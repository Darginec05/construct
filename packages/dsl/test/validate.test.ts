import { describe, expect, it } from "vitest";
import {
  type Flow,
  SCHEMA_VERSION,
  assertValidFlow,
  parseFlow,
  validateFlow,
} from "../src/index.js";

function makeFlow(overrides: Partial<Flow> = {}): Flow {
  return parseFlow({
    schemaVersion: SCHEMA_VERSION,
    id: "f",
    name: "n",
    nodes: [
      { id: "in", type: "input", config: { schema: { x: "text" } } },
      { id: "out", type: "output", config: { from: "$.x" } },
    ],
    edges: [{ id: "e", source: "in", target: "out" }],
    ...overrides,
  });
}

const errors = (flow: Flow) =>
  validateFlow(flow).filter((i) => i.level === "error");
const messages = (flow: Flow) => validateFlow(flow).map((i) => i.message);

describe("validateFlow — happy path", () => {
  it("reports no errors for a well-formed flow", () => {
    expect(errors(makeFlow())).toEqual([]);
  });
});

describe("validateFlow — structural checks", () => {
  it("flags duplicate node ids", () => {
    const flow = makeFlow({
      nodes: [
        { id: "dup", type: "input", config: {} },
        { id: "dup", type: "output", config: { from: "$.x" } },
      ],
      edges: [],
    });
    expect(messages(flow).some((m) => m.includes("duplicate node id"))).toBe(
      true,
    );
  });

  it("flags edges with non-existent endpoints", () => {
    const flow = makeFlow({
      edges: [{ id: "e", source: "ghost", target: "out" }],
    });
    expect(
      messages(flow).some((m) => m.includes('source "ghost" is not a node')),
    ).toBe(true);
  });

  it("flags an invalid source handle", () => {
    const flow = makeFlow({
      nodes: [
        { id: "b", type: "branch", config: { condition: "$.x" } },
        { id: "out", type: "output", config: { from: "$.x" } },
      ],
      edges: [
        { id: "e", source: "b", target: "out", sourceHandle: "maybe" },
      ],
    });
    expect(
      messages(flow).some((m) => m.includes('handle "maybe" not in')),
    ).toBe(true);
  });

  it("accepts a valid source handle", () => {
    const flow = makeFlow({
      nodes: [
        { id: "b", type: "branch", config: { condition: "$.x" } },
        { id: "out", type: "output", config: { from: "$.x" } },
      ],
      edges: [{ id: "e", source: "b", target: "out", sourceHandle: "true" }],
    });
    expect(errors(flow)).toEqual([]);
  });
});

describe("validateFlow — config & references", () => {
  it("flags invalid node config against the catalog", () => {
    const flow = makeFlow({
      nodes: [{ id: "a", type: "agent", config: {} }],
      edges: [],
    });
    const errs = errors(flow);
    expect(errs.some((e) => e.nodeId === "a")).toBe(true);
  });

  it("accepts a registry PromptRef as the agent system/prompt source", () => {
    const flow = makeFlow({
      nodes: [
        { id: "in", type: "input", config: { schema: { x: "text" } } },
        {
          id: "a",
          type: "agent",
          config: {
            model: { provider: "anthropic", model: "m" },
            system: { ref: "reviewer", vars: { focus: "$.x" } },
            writeTo: "out",
          },
        },
        { id: "out", type: "output", config: { from: "$.out" } },
      ],
      edges: [
        { id: "e1", source: "in", target: "a" },
        { id: "e2", source: "a", target: "out" },
      ],
    });
    expect(errors(flow)).toEqual([]);
    // A PromptRef counts as content, so no "neither prompt nor system" warning.
    expect(messages(flow).some((m) => m.includes("neither a prompt"))).toBe(false);
  });

  it("validates expressions bound to a PromptRef's vars", () => {
    const flow = makeFlow({
      nodes: [
        { id: "in", type: "input", config: { schema: { x: "text" } } },
        {
          id: "a",
          type: "agent",
          config: {
            model: { provider: "anthropic", model: "m" },
            system: { ref: "reviewer", vars: { focus: "$.ghost" } },
            writeTo: "out",
          },
        },
        { id: "out", type: "output", config: { from: "$.out" } },
      ],
      edges: [
        { id: "e1", source: "in", target: "a" },
        { id: "e2", source: "a", target: "out" },
      ],
    });
    expect(messages(flow).some((m) => m.includes('unknown variable "ghost"'))).toBe(true);
  });

  it("no longer errors on a writeTo to an undeclared channel (it defines a variable)", () => {
    const flow = makeFlow({
      channels: [],
      nodes: [
        { id: "in", type: "input", config: { schema: { x: "text" } } },
        { id: "t", type: "transform", config: { expr: "$.x", writeTo: "result" } },
        { id: "out", type: "output", config: { from: "$.result" } },
      ],
      edges: [
        { id: "e1", source: "in", target: "t" },
        { id: "e2", source: "t", target: "out" },
      ],
    });
    expect(errors(flow)).toEqual([]);
    // …and the produced name resolves downstream, so no unknown-variable warning.
    expect(messages(flow).some((m) => m.includes("unknown variable"))).toBe(false);
  });

  it("warns on a reference to an unknown variable", () => {
    const flow = makeFlow({
      nodes: [
        { id: "in", type: "input", config: { schema: { x: "text" } } },
        { id: "out", type: "output", config: { from: "$.ghost" } },
      ],
      edges: [{ id: "e", source: "in", target: "out" }],
    });
    const issue = validateFlow(flow).find((i) => i.message.includes("unknown variable"));
    expect(issue?.level).toBe("warning");
    expect(issue?.message).toContain('unknown variable "ghost"');
  });

  it("seeds extra names via scopeVariables (loop/map body bindings)", () => {
    const flow = makeFlow({
      nodes: [
        { id: "in", type: "input", config: { schema: {} } },
        { id: "out", type: "output", config: { from: "$.item" } },
      ],
      edges: [{ id: "e", source: "in", target: "out" }],
    });
    expect(messages(flow).some((m) => m.includes('unknown variable "item"'))).toBe(true);
    expect(
      validateFlow(flow, { scopeVariables: ["item", "index"] }).some((i) =>
        i.message.includes("unknown variable"),
      ),
    ).toBe(false);
  });

  it("flags a tool bound to an undeclared resource", () => {
    const flow = makeFlow({
      resources: [],
      nodes: [
        { id: "tl", type: "tool", config: { tool: "t", resource: "sandbox" } },
      ],
      edges: [],
    });
    expect(
      messages(flow).some((m) => m.includes('undeclared resource "sandbox"')),
    ).toBe(true);
  });

  it("flags a quorum join without a count", () => {
    const flow = makeFlow({
      nodes: [{ id: "j", type: "join", config: { mode: "quorum" } }],
      edges: [],
    });
    expect(
      messages(flow).some((m) => m.includes("quorum join requires")),
    ).toBe(true);
  });

  it("warns on an unknown (plugin) node type", () => {
    const flow = makeFlow({
      nodes: [{ id: "p", type: "my-plugin", config: {} }],
      edges: [],
    });
    const issue = validateFlow(flow).find((i) => i.nodeId === "p");
    expect(issue?.level).toBe("warning");
    expect(issue?.message).toContain("unknown node type");
  });
});

describe("validateFlow — flow-level warnings", () => {
  it("warns when input or output nodes are missing", () => {
    const flow = makeFlow({ nodes: [], edges: [] });
    const msgs = messages(flow);
    expect(msgs).toContain("flow has no input node");
    expect(msgs).toContain("flow has no output node");
  });
});

describe("assertValidFlow", () => {
  it("throws when there are error-level issues", () => {
    const flow = makeFlow({
      nodes: [
        { id: "dup", type: "input", config: {} },
        { id: "dup", type: "output", config: { from: "$.x" } },
      ],
      edges: [],
    });
    expect(() => assertValidFlow(flow)).toThrow(/invalid flow/);
  });

  it("does not throw for a valid flow (warnings are tolerated)", () => {
    expect(() => assertValidFlow(makeFlow())).not.toThrow();
  });
});
