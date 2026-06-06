import { type Flow, parseFlow } from "@construct/dsl";
import { type RunResult, runFlow } from "@construct/engine";

/**
 * Entry point for the self-hosted API server. The HTTP/WS framework (Hono or
 * Fastify) and persistence layer will be wired here. For now it exposes the
 * core run handler the eventual REST endpoint (`POST /v1/runs`) delegates to.
 */
export async function handleRun(payload: {
  flow: unknown;
  input?: Record<string, unknown>;
}): Promise<RunResult> {
  const flow: Flow = parseFlow(payload.flow);
  return runFlow(flow, { initialState: payload.input ?? {} });
}
