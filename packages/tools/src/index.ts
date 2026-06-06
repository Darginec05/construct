/** A callable tool an agent can invoke. The Plugin SDK builds on this interface. */
export interface Tool<Input = unknown, Output = unknown> {
  name: string;
  description: string;
  run(input: Input): Promise<Output>;
}

const registry = new Map<string, Tool>();

export function registerTool(tool: Tool): void {
  registry.set(tool.name, tool);
}

export function getTool(name: string): Tool | undefined {
  return registry.get(name);
}

export function listTools(): Tool[] {
  return [...registry.values()];
}
