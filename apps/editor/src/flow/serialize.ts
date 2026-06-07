import { SCHEMA_VERSION, type Flow } from "@construct/dsl";
import type { FlowDoc } from "./flow-context.tsx";

/** Project the editor's working flow into the canonical DSL Flow shape. */
export function toDslFlow(doc: FlowDoc): Flow {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: doc.id,
    name: doc.name,
    channels: [],
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
