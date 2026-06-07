import type { Flow } from "@construct/dsl";
import type { RunStatus } from "@construct/engine";

/** A flow persisted in the workspace, with bookkeeping timestamps. */
export interface StoredFlow {
  id: string;
  name: string;
  flow: Flow;
  /** Epoch milliseconds. */
  createdAt: number;
  updatedAt: number;
}

/**
 * A single execution of a flow, persisted after it finishes (or pauses).
 *
 * `pause` is recorded when a run stops at a `human` node, but the OSS server has
 * no resume endpoint yet (it needs engine state snapshots), so a paused run is
 * currently a terminal record — informational, not resumable.
 */
export interface RunRecord {
  id: string;
  flowId: string;
  status: RunStatus;
  input: Record<string, unknown>;
  state: Record<string, unknown>;
  output?: unknown;
  error?: string;
  pause?: { nodeId: string; exits: string[] };
  /** Epoch milliseconds. */
  createdAt: number;
}

/** Fields accepted when creating or updating a flow. */
export interface SaveFlowInput {
  /** Omit to mint a new id. */
  id?: string;
  name?: string;
  flow: Flow;
}

/**
 * Window into a list query. Omit `limit` to return every row (used internally,
 * e.g. to expose all flows as possible subflows); the HTTP routes always pass a
 * bounded `limit` so an endpoint can never serialize unbounded history.
 */
export interface ListOptions {
  limit?: number;
  offset?: number;
}

/**
 * Persistence boundary for the self-host server. Both adapters (in-memory and
 * `node:sqlite`) are synchronous, so the interface is too — flows are small and
 * the reference server is single-process. A multi-tenant cloud control plane
 * would implement this against Postgres behind its own async wrapper.
 */
export interface Store {
  saveFlow(input: SaveFlowInput): StoredFlow;
  getFlow(id: string): StoredFlow | undefined;
  listFlows(opts?: ListOptions): StoredFlow[];
  deleteFlow(id: string): boolean;

  saveRun(record: RunRecord): void;
  getRun(id: string): RunRecord | undefined;
  /** Most-recent-first; optionally scoped to one flow and/or windowed. */
  listRuns(flowId?: string, opts?: ListOptions): RunRecord[];

  /** Release underlying resources (e.g. close the SQLite handle). */
  close?(): void;
}
