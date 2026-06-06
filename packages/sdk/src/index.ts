import type { Flow } from "@construct/dsl";

export interface ConstructClientOptions {
  baseUrl: string;
  apiKey?: string;
}

/** Thin client for running flows against a Construct server. */
export class ConstructClient {
  constructor(private readonly options: ConstructClientOptions) {}

  async run(flow: Flow, input: Record<string, unknown> = {}): Promise<unknown> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.options.apiKey) {
      headers["authorization"] = `Bearer ${this.options.apiKey}`;
    }
    const response = await fetch(`${this.options.baseUrl}/v1/runs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ flow, input }),
    });
    if (!response.ok) {
      throw new Error(`Construct run failed: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }
}
