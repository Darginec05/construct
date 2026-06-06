import type { RunState } from "@construct/engine";

export interface NodeContext<Config = Record<string, unknown>> {
  config: Config;
  state: RunState;
}

/** A node implementation. Returns a partial state patch merged back into the run. */
export interface NodeDefinition<Config = Record<string, unknown>> {
  type: string;
  execute(ctx: NodeContext<Config>): Promise<Partial<RunState>>;
}

const registry = new Map<string, NodeDefinition>();

export function registerNode(definition: NodeDefinition): void {
  registry.set(definition.type, definition);
}

export function getNode(type: string): NodeDefinition | undefined {
  return registry.get(type);
}

export function listNodes(): NodeDefinition[] {
  return [...registry.values()];
}

// Built-in node types planned: llm, agent, supervisor, tool, router, loop,
// code, http, rag-retrieve, human-in-loop, sub-agent.
