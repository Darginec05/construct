import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, parseFlow } from "../src/index.js";

const minimal = {
  schemaVersion: SCHEMA_VERSION,
  id: "f1",
  name: "Test flow",
  nodes: [],
  edges: [],
};

describe("parseFlow", () => {
  it("parses a minimal flow and applies container defaults", () => {
    const flow = parseFlow(minimal);
    expect(flow.id).toBe("f1");
    expect(flow.channels).toEqual([]);
    expect(flow.resources).toEqual([]);
    expect(flow.config).toEqual({});
    expect(flow.metadata).toEqual({});
  });

  it("defaults a node's config to {}", () => {
    const flow = parseFlow({
      ...minimal,
      nodes: [{ id: "n1", type: "input" }],
    });
    expect(flow.nodes[0]!.config).toEqual({});
  });

  it("keeps optional edge handles when provided", () => {
    const flow = parseFlow({
      ...minimal,
      nodes: [
        { id: "a", type: "branch" },
        { id: "b", type: "output" },
      ],
      edges: [
        { id: "e1", source: "a", target: "b", sourceHandle: "true" },
      ],
    });
    expect(flow.edges[0]!.sourceHandle).toBe("true");
    expect(flow.edges[0]!.targetHandle).toBeUndefined();
  });

  it("rejects an unsupported schema version", () => {
    expect(() => parseFlow({ ...minimal, schemaVersion: 99 })).toThrow();
  });

  it("requires nodes and edges arrays", () => {
    expect(() =>
      parseFlow({ schemaVersion: SCHEMA_VERSION, id: "f", name: "n" }),
    ).toThrow();
  });

  it("requires id and name", () => {
    expect(() =>
      parseFlow({ schemaVersion: SCHEMA_VERSION, nodes: [], edges: [] }),
    ).toThrow();
  });
});
