import { type Flow, parseFlow } from "@construct/dsl";

/** Mutable state object threaded through the graph during a run. */
export interface RunState {
  [key: string]: unknown;
}

export type RunStatus = "completed" | "paused" | "failed";

export interface RunResult {
  flowId: string;
  status: RunStatus;
  state: RunState;
}

export interface RunEvent {
  type: "run-start" | "node-start" | "node-finish" | "run-finish" | "error";
  nodeId?: string;
  data?: unknown;
}

export interface RunOptions {
  initialState?: RunState;
  onEvent?: (event: RunEvent) => void;
}

/**
 * Execute a flow. The real implementation will be a stateful graph runner
 * supporting branching, loops, parallel fan-out/fan-in, retries, and durable
 * human-in-the-loop pauses. For now this validates the flow and returns.
 */
export async function runFlow(flow: Flow, options: RunOptions = {}): Promise<RunResult> {
  const parsed = parseFlow(flow);
  const state: RunState = { ...options.initialState };
  options.onEvent?.({ type: "run-start" });
  // TODO: implement graph execution over parsed.nodes / parsed.edges.
  options.onEvent?.({ type: "run-finish" });
  return { flowId: parsed.id, status: "completed", state };
}
