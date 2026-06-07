import type { Flow } from "@construct/dsl";

export interface ConstructClientOptions {
  baseUrl: string;
  apiKey?: string;
}

/** A flow as stored by the server, returned from {@link ConstructClient.saveFlow}. */
export interface PublishedFlow {
  id: string;
  name: string;
  flow: Flow;
  createdAt: number;
  updatedAt: number;
}

/** A streamed run event, mirroring the engine's `RunEvent` over the wire. */
export interface RunEvent {
  type: "run-start" | "node-start" | "node-finish" | "run-finish" | "paused" | "token" | "error";
  nodeId?: string;
  data?: unknown;
}

/** The persisted result of a run, returned from {@link ConstructClient.run}. */
export interface RunRecord {
  id: string;
  flowId: string;
  status: "completed" | "paused" | "failed";
  input: Record<string, unknown>;
  state: Record<string, unknown>;
  output?: unknown;
  error?: string;
  pause?: { nodeId: string; exits: string[] };
  createdAt: number;
}

/** Parse one SSE frame ("event: …\ndata: …") into its event name and payload. */
function parseSseFrame(frame: string): { event?: string; data: string } {
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  return { event, data: dataLines.join("\n") };
}

/** Thin client for a Construct server. */
export class ConstructClient {
  constructor(private readonly options: ConstructClientOptions) {}

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.options.apiKey) headers["authorization"] = `Bearer ${this.options.apiKey}`;
    return headers;
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const response = await fetch(`${this.options.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Construct ${path} failed: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ""}`,
      );
    }
    return response.json();
  }

  /** Execute a flow and return its run record. */
  run(flow: Flow, input: Record<string, unknown> = {}): Promise<unknown> {
    return this.post("/v1/runs", { flow, input });
  }

  /**
   * Execute a flow and stream its run events (node-start/finish, tokens, …) as
   * the server emits them, resolving with the persisted {@link RunRecord} once
   * the run ends. Real provider calls happen server-side, so this needs a server
   * started with the relevant `*_API_KEY` env.
   */
  async runStream(
    flow: Flow,
    input: Record<string, unknown>,
    onEvent: (event: RunEvent) => void,
  ): Promise<RunRecord> {
    const response = await fetch(`${this.options.baseUrl}/v1/runs`, {
      method: "POST",
      headers: { ...this.headers(), accept: "text/event-stream" },
      body: JSON.stringify({ flow, input }),
    });
    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Construct /v1/runs failed: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ""}`,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let record: RunRecord | undefined;
    let streamError: string | undefined;

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const { event, data } = parseSseFrame(frame);
          if (!event || !data) continue;
          const payload = JSON.parse(data) as Record<string, unknown>;
          if (event === "run-record") {
            record = payload as unknown as RunRecord;
          } else if ("type" in payload) {
            // A forwarded engine event — including node-level "error" events,
            // which must light up the node, not abort the whole stream.
            onEvent(payload as unknown as RunEvent);
          } else {
            // The server's own failure (catch block): { error: string }.
            streamError = (payload.error as string | undefined) ?? data;
          }
        }
      }
    } finally {
      // Release the connection even if a JSON.parse throws mid-stream.
      await reader.cancel().catch(() => {});
    }

    if (streamError) throw new Error(streamError);
    if (!record) throw new Error("run stream ended without a result");
    return record;
  }

  /**
   * Persist a flow to the server (create or update). Passing the flow's own id
   * upserts it, so re-publishing the same flow updates the stored record rather
   * than creating a duplicate.
   */
  async saveFlow(
    flow: Flow,
    options: { id?: string; name?: string } = {},
  ): Promise<PublishedFlow> {
    return (await this.post("/v1/flows", {
      id: options.id ?? flow.id,
      name: options.name ?? flow.name,
      flow,
    })) as PublishedFlow;
  }
}
