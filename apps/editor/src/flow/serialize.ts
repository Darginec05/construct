import { SCHEMA_VERSION, type Channel, type Flow } from "@construct/dsl";
import type { FlowDoc } from "./flow-context.tsx";

/** Project the editor's working flow into the canonical DSL Flow shape. */
export function toDslFlow(doc: FlowDoc): Flow {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: doc.id,
    name: doc.name,
    // The editor has no channel surface yet: auto-declare a lastValue channel
    // for every `writeTo` target so flows validate and run.
    channels: deriveChannels(doc),
    resources: [],
    nodes: doc.nodes.map((n) => ({
      id: n.id,
      type: n.data.type,
      config: n.data.config,
      position: n.position,
    })),
    edges: doc.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
      ...(e.targetHandle ? { targetHandle: e.targetHandle } : {}),
    })),
    config: {},
    metadata: {},
  };
}

function deriveChannels(doc: FlowDoc): Channel[] {
  const names = new Set<string>();
  for (const n of doc.nodes) {
    const writeTo = (n.data.config as Record<string, unknown>).writeTo;
    if (typeof writeTo === "string" && writeTo) names.add(writeTo);
  }
  return [...names].map((name) => ({ name, type: "any", reducer: "lastValue" }));
}
