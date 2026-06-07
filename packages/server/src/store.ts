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

/** A single execution of a flow, persisted after it finishes (or pauses). */
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
 * Persistence boundary for the self-host server. Both adapters (in-memory and
 * `node:sqlite`) are synchronous, so the interface is too — flows are small and
 * the reference server is single-process. A multi-tenant cloud control plane
 * would implement this against Postgres behind its own async wrapper.
 */
export interface Store {
  saveFlow(input: SaveFlowInput): StoredFlow;
  getFlow(id: string): StoredFlow | undefined;
  listFlows(): StoredFlow[];
  deleteFlow(id: string): boolean;

  saveRun(record: RunRecord): void;
  getRun(id: string): RunRecord | undefined;
  /** Most-recent-first; optionally scoped to one flow. */
  listRuns(flowId?: string): RunRecord[];
}
