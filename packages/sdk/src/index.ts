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
