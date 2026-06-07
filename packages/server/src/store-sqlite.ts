import { DatabaseSync } from "node:sqlite";
import type { Flow } from "@construct/dsl";
import type { RunStatus } from "@construct/engine";
import type {
  ListOptions,
  RunRecord,
  SaveFlowInput,
  Store,
  StoredFlow,
} from "./store.js";

/** SQLite bind params for a window: `LIMIT -1` means unbounded. */
function windowParams(opts?: ListOptions): [number, number] {
  const limit = opts?.limit === undefined ? -1 : Math.max(0, opts.limit);
  const offset = Math.max(0, opts?.offset ?? 0);
  return [limit, offset];
}

interface FlowRow {
  id: string;
  name: string;
  flow: string;
  created_at: number;
  updated_at: number;
}

interface RunRow {
  id: string;
  flow_id: string;
  status: string;
  input: string;
  state: string;
  output: string | null;
  error: string | null;
  pause: string | null;
  created_at: number;
}

/**
 * Durable {@link Store} on Node's built-in `node:sqlite` (Node 22+). Chosen over
 * a native module (better-sqlite3) so the self-host server has zero
 * compile-time deps — `npx construct-server` just works on a stock Node 22+.
 */
export class SqliteStore implements Store {
  private db: DatabaseSync;

  /** @param path File path, or ":memory:" for an ephemeral database. */
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS flows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        flow TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        flow_id TEXT NOT NULL,
        status TEXT NOT NULL,
        input TEXT NOT NULL,
        state TEXT NOT NULL,
        output TEXT,
        error TEXT,
        pause TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_runs_flow ON runs (flow_id, created_at DESC);
    `);
  }

  close(): void {
    this.db.close();
  }

  saveFlow(input: SaveFlowInput): StoredFlow {
    const now = Date.now();
    const id = input.id ?? crypto.randomUUID();
    const existing = this.getFlow(id);
    const stored: StoredFlow = {
      id,
      name: input.name ?? existing?.name ?? input.flow.name ?? "Untitled",
      flow: input.flow,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO flows (id, name, flow, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           flow = excluded.flow,
           updated_at = excluded.updated_at`,
      )
      .run(
        stored.id,
        stored.name,
        JSON.stringify(stored.flow),
        stored.createdAt,
        stored.updatedAt,
      );
    return stored;
  }

  getFlow(id: string): StoredFlow | undefined {
    const row = this.db.prepare(`SELECT * FROM flows WHERE id = ?`).get(id) as
      | FlowRow
      | undefined;
    return row ? this.toStoredFlow(row) : undefined;
  }

  listFlows(opts?: ListOptions): StoredFlow[] {
    const rows = this.db
      .prepare(`SELECT * FROM flows ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
      .all(...windowParams(opts)) as unknown as FlowRow[];
    return rows.map((r) => this.toStoredFlow(r));
  }

  deleteFlow(id: string): boolean {
    const info = this.db.prepare(`DELETE FROM flows WHERE id = ?`).run(id);
    return info.changes > 0;
  }

  saveRun(record: RunRecord): void {
    this.db
      .prepare(
        `INSERT INTO runs
           (id, flow_id, status, input, state, output, error, pause, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           state = excluded.state,
           output = excluded.output,
           error = excluded.error,
           pause = excluded.pause`,
      )
      .run(
        record.id,
        record.flowId,
        record.status,
        JSON.stringify(record.input),
        JSON.stringify(record.state),
        record.output === undefined ? null : JSON.stringify(record.output),
        record.error ?? null,
        record.pause ? JSON.stringify(record.pause) : null,
        record.createdAt,
      );
  }

  getRun(id: string): RunRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM runs WHERE id = ?`).get(id) as
      | RunRow
      | undefined;
    return row ? this.toRunRecord(row) : undefined;
  }

  listRuns(flowId?: string, opts?: ListOptions): RunRecord[] {
    const [limit, offset] = windowParams(opts);
    const rows = (
      flowId
        ? this.db
            .prepare(
              `SELECT * FROM runs WHERE flow_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
            )
            .all(flowId, limit, offset)
        : this.db
            .prepare(
              `SELECT * FROM runs ORDER BY created_at DESC LIMIT ? OFFSET ?`,
            )
            .all(limit, offset)
    ) as unknown as RunRow[];
    return rows.map((r) => this.toRunRecord(r));
  }

  private toStoredFlow(row: FlowRow): StoredFlow {
    return {
      id: row.id,
      name: row.name,
      flow: JSON.parse(row.flow) as Flow,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toRunRecord(row: RunRow): RunRecord {
    return {
      id: row.id,
      flowId: row.flow_id,
      status: row.status as RunStatus,
      input: JSON.parse(row.input) as Record<string, unknown>,
      state: JSON.parse(row.state) as Record<string, unknown>,
      output: row.output === null ? undefined : JSON.parse(row.output),
      error: row.error ?? undefined,
      pause: row.pause
        ? (JSON.parse(row.pause) as { nodeId: string; exits: string[] })
        : undefined,
      createdAt: row.created_at,
    };
  }
}
