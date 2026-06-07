import { type Flow, parseFlow } from "@construct/dsl";
import { type RunResult, runFlow } from "@construct/engine";
import { registerRuntime } from "./runtime.js";

/**
 * @construct/server — the self-host API for a single workspace. It persists
 * flows and runs (in memory or `node:sqlite`), executes them through
 * @construct/engine with the built-in nodes + model providers registered, and
 * serves a small REST surface over Hono.
 *
 * The OSS server is intentionally single-tenant and keyless-friendly; the cloud
 * control plane is a separate, private layer on top of the same DSL contract.
 */

export { createApp, type AppOptions } from "./app.js";
export {
  createServer,
  start,
  type ServerOptions,
  type ConstructServer,
} from "./server.js";
export { executeRun, type ExecuteRunInput } from "./runs.js";
export { registerRuntime } from "./runtime.js";
export { MemoryStore } from "./store-memory.js";
export { SqliteStore } from "./store-sqlite.js";
export type {
  Store,
  StoredFlow,
  RunRecord,
  SaveFlowInput,
} from "./store.js";

/**
 * One-shot run of an inline flow with no persistence — the thin entry the very
 * first REST prototype used. Kept for embedding / tests; prefer
 * {@link executeRun} when you have a {@link Store}.
 */
export async function handleRun(payload: {
  flow: unknown;
  input?: Record<string, unknown>;
}): Promise<RunResult> {
  registerRuntime();
  const flow: Flow = parseFlow(payload.flow);
  return runFlow(flow, { input: payload.input ?? {} });
}
