import type { RunRecord, SaveFlowInput, Store, StoredFlow } from "./store.js";

/**
 * Ephemeral {@link Store} backed by plain maps. The default when no database is
 * configured — perfect for tests and `npx construct-server` smoke runs, but its
 * contents vanish on restart. Point `CONSTRUCT_DB` at a file for durability.
 */
export class MemoryStore implements Store {
  private flows = new Map<string, StoredFlow>();
  private runs = new Map<string, RunRecord>();

  saveFlow(input: SaveFlowInput): StoredFlow {
    const now = Date.now();
    const id = input.id ?? crypto.randomUUID();
    const existing = this.flows.get(id);
    const stored: StoredFlow = {
      id,
      name: input.name ?? existing?.name ?? input.flow.name ?? "Untitled",
      flow: input.flow,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.flows.set(id, stored);
    return stored;
  }

  getFlow(id: string): StoredFlow | undefined {
    return this.flows.get(id);
  }

  listFlows(): StoredFlow[] {
    return [...this.flows.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  deleteFlow(id: string): boolean {
    return this.flows.delete(id);
  }

  saveRun(record: RunRecord): void {
    this.runs.set(record.id, record);
  }

  getRun(id: string): RunRecord | undefined {
    return this.runs.get(id);
  }

  listRuns(flowId?: string): RunRecord[] {
    return [...this.runs.values()]
      .filter((r) => (flowId ? r.flowId === flowId : true))
      .sort((a, b) => b.createdAt - a.createdAt);
  }
}
