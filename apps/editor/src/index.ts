import { SCHEMA_VERSION, type Flow } from "@construct/dsl";
import { ConstructClient } from "@construct/sdk";

/**
 * Placeholder for the visual flow editor. This will become a Vite + React app
 * built on a graph canvas (xyflow / React Flow) that reads and writes the
 * @construct/dsl Flow shape and runs flows via @construct/sdk.
 */
export function createEmptyFlow(id: string, name: string): Flow {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    channels: [],
    resources: [],
    nodes: [],
    edges: [],
    config: {},
    metadata: {},
  };
}

export { ConstructClient };
