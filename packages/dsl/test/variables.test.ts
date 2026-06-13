import { describe, expect, it } from "vitest";
import {
  type Flow,
  SCHEMA_VERSION,
  flowVariables,
  flowVariableNames,
  loopBodyVariables,
  parseFlow,
  variablesInScope,
} from "../src/index.js";

function makeFlow(overrides: Partial<Flow> = {}): Flow {
  return parseFlow({
    schemaVersion: SCHEMA_VERSION,
    id: "f",
    name: "n",
    nodes: [
      { id: "in", type: "input", config: { schema: { message: "text" } } },
      { id: "out", type: "output", config: { from: "$.message" } },
    ],
    edges: [{ id: "e", source: "in", target: "out" }],
    ...overrides,
  });
}

const byName = (flow: Flow) => new Map(flowVariables(flow).map((v) => [v.name, v]));

describe("flowVariables — input fields", () => {
  it("derives a variable from an input node's schema field", () => {
    const v = byName(makeFlow()).get("message");
    expect(v).toMatchObject({
      name: "message",
      type: "text",
      source: "input",
      availableAtStart: true,
      producers: [],
    });
  });

  it("does not require a channel declaration for the input field", () => {
    expect(flowVariableNames(makeFlow()).has("message")).toBe(true);
  });
});

describe("flowVariables — writeTo producers", () => {
  it("registers a variable produced by a node's writeTo with its producer id", () => {
    const flow = makeFlow({
      nodes: [
        { id: "in", type: "input", config: { schema: { message: "text" } } },
        {
          id: "router",
          type: "classifier",
          config: {
            model: { provider: "anthropic", model: "claude-haiku-4-5" },
            prompt: "{{message}}",
            classes: ["a", "b"],
            writeTo: "intent",
          },
        },
        { id: "out", type: "output", config: { from: "$.intent" } },
      ],
      edges: [
        { id: "e1", source: "in", target: "router" },
        { id: "e2", source: "router", target: "out" },
      ],
    });
    const v = byName(flow).get("intent");
    expect(v).toMatchObject({ source: "produced", producers: ["router"], availableAtStart: false });
  });

  it("collects multiple producers for the same fan-out target", () => {
    const flow = makeFlow({
      channels: [{ name: "acc", type: "json", reducer: "append" }],
      nodes: [
        { id: "in", type: "input", config: { schema: { message: "text" } } },
        { id: "a", type: "transform", config: { expr: "$.message", writeTo: "acc" } },
        { id: "b", type: "transform", config: { expr: "$.message", writeTo: "acc" } },
        { id: "out", type: "output", config: { from: "$.acc" } },
      ],
      edges: [
        { id: "e1", source: "in", target: "a" },
        { id: "e2", source: "in", target: "b" },
        { id: "e3", source: "a", target: "out" },
      ],
    });
    expect(byName(flow).get("acc")?.producers).toEqual(["a", "b"]);
  });
});

describe("flowVariables — channels precedence", () => {
  it("an explicit channel pins reducer and is the source label when no input shadows it", () => {
    const flow = makeFlow({
      channels: [{ name: "route", type: "json", reducer: "merge", description: "router output" }],
    });
    expect(byName(flow).get("route")).toMatchObject({
      source: "channel",
      reducer: "merge",
      type: "json",
      description: "router output",
    });
  });

  it("a channel with an initial value is available at start", () => {
    const flow = makeFlow({ channels: [{ name: "counter", type: "json", initial: 0 }] });
    expect(byName(flow).get("counter")?.availableAtStart).toBe(true);
  });

  it("an input field shadows a same-named channel as the source but keeps the channel reducer", () => {
    const flow = makeFlow({
      channels: [{ name: "message", type: "text", reducer: "append" }],
    });
    expect(byName(flow).get("message")).toMatchObject({
      source: "input",
      reducer: "append",
      availableAtStart: true,
    });
  });
});

describe("variablesInScope", () => {
  // in → a (writes x) → b (reads x) → out
  const linear = (): Flow =>
    makeFlow({
      nodes: [
        { id: "in", type: "input", config: { schema: { message: "text" } } },
        { id: "a", type: "transform", config: { expr: "$.message", writeTo: "x" } },
        { id: "b", type: "transform", config: { expr: "$.x", writeTo: "y" } },
        { id: "out", type: "output", config: { from: "$.y" } },
      ],
      edges: [
        { id: "e1", source: "in", target: "a" },
        { id: "e2", source: "a", target: "b" },
        { id: "e3", source: "b", target: "out" },
      ],
    });

  const scopeAt = (flow: Flow, nodeId: string | null) =>
    new Map(variablesInScope(flow, nodeId).map((v) => [v.name, v.inScope]));

  it("input variables are in scope everywhere", () => {
    expect(scopeAt(linear(), "a").get("message")).toBe(true);
    expect(scopeAt(linear(), null).get("message")).toBe(true);
  });

  it("a produced variable is in scope only downstream of its producer", () => {
    expect(scopeAt(linear(), "b").get("x")).toBe(true); // a is an ancestor of b
    expect(scopeAt(linear(), "a").get("x")).toBe(false); // a writes x; not yet in scope at a
    expect(scopeAt(linear(), "in").get("x")).toBe(false);
  });

  it("a loop back-edge puts a downstream writer in scope (loop-carried value)", () => {
    // a (reads y) ⇄ b (writes y): the b→a back-edge makes b an ancestor of a.
    const flow = makeFlow({
      channels: [{ name: "y", type: "json", reducer: "append" }],
      nodes: [
        { id: "in", type: "input", config: { schema: { message: "text" } } },
        { id: "a", type: "transform", config: { expr: "$.y", writeTo: "acc" } },
        { id: "b", type: "transform", config: { expr: "$.message", writeTo: "y" } },
        { id: "out", type: "output", config: { from: "$.acc" } },
      ],
      edges: [
        { id: "e1", source: "in", target: "a" },
        { id: "e2", source: "a", target: "b" },
        { id: "e3", source: "b", target: "a" },
        { id: "e4", source: "b", target: "out" },
      ],
    });
    expect(scopeAt(flow, "a").get("y")).toBe(true);
  });
});

describe("flowVariables — loop bindings", () => {
  it("omits item/index by default", () => {
    const names = flowVariableNames(makeFlow());
    expect(names.has("item")).toBe(false);
    expect(names.has("index")).toBe(false);
  });

  it("includes item/index when asked (loop/map body)", () => {
    const names = flowVariableNames(makeFlow(), { includeLoopBindings: true });
    expect(names.has("item")).toBe(true);
    expect(names.has("index")).toBe(true);
  });

  it("loopBodyVariables are seeded at start", () => {
    expect(loopBodyVariables().every((v) => v.availableAtStart)).toBe(true);
  });
});
