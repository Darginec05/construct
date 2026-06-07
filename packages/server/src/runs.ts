import { type Flow, parseFlow } from "@construct/dsl";
import { type RunEvent, runFlow } from "@construct/engine";
import { registerRuntime } from "./runtime.js";
import type { RunRecord, Store } from "./store.js";

export interface ExecuteRunInput {
  /** Run a stored flow by id. Mutually exclusive with `flow`. */
  flowId?: string;
  /** Run an inline flow document (parsed + validated here). */
  flow?: unknown;
  input?: Record<string, unknown>;
  onEvent?: (event: RunEvent) => void;
}

/**
 * Execute a flow and persist the result as a {@link RunRecord}. Resolves the
 * target either from the store (`flowId`) or from an inline document (`flow`),
 * exposes every stored flow as a possible subflow body, and writes the outcome
 * back through the store before returning.
 *
 * Two safety limitations of the OSS server, both pending durable resume:
 *  - No tool-approval surface is wired, so the engine receives no approver:
 *    gated tools (write/bulk/dangerous or `requiresApproval`) fail safe — they
 *    are denied, never silently run. A flow needing them will fail here.
 *  - A run that pauses at a `human` node is persisted with its `pause` info but
 *    cannot be resumed yet; treat such records as terminal.
 */
export async function executeRun(
  store: Store,
  input: ExecuteRunInput,
): Promise<RunRecord> {
  registerRuntime();

  let flow: Flow;
  let flowId: string;
  if (input.flowId !== undefined) {
    const stored = store.getFlow(input.flowId);
    if (!stored) throw new Error(`flow not found: ${input.flowId}`);
    flow = stored.flow;
    flowId = stored.id;
  } else if (input.flow !== undefined) {
    flow = parseFlow(input.flow);
    flowId = flow.id;
  } else {
    throw new Error("executeRun requires either `flowId` or `flow`");
  }

  const flows: Record<string, Flow> = {};
  for (const f of store.listFlows()) flows[f.id] = f.flow;
  flows[flow.id] = flow;

  const payload = input.input ?? {};
  const result = await runFlow(flow, {
    input: payload,
    flows,
    onEvent: input.onEvent,
  });

  const record: RunRecord = {
    id: crypto.randomUUID(),
    flowId,
    status: result.status,
    input: payload,
    state: result.state,
    output: result.output,
    error: result.error,
    pause: result.pause,
    createdAt: Date.now(),
  };
  store.saveRun(record);
  return record;
}
