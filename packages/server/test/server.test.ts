import { SCHEMA_VERSION, type Flow } from "@construct/dsl";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { MemoryStore } from "../src/store-memory.js";

function echoFlow(): Flow {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "echo",
    name: "echo",
    channels: [{ name: "reply", type: "text", reducer: "lastValue" }],
    resources: [],
    nodes: [
      { id: "in", type: "input", config: { schema: { message: "text" } } },
      {
        id: "agent",
        type: "agent",
        config: {
          model: { provider: "fake", model: "m" },
          prompt: "{{ $.message }}",
          writeTo: "reply",
        },
      },
      { id: "out", type: "output", config: { from: "$.reply" } },
    ],
    edges: [
      { id: "e1", source: "in", target: "agent" },
      { id: "e2", source: "agent", target: "out" },
    ],
  };
}

describe("construct-server", () => {
  let store: MemoryStore;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    store = new MemoryStore();
    app = createApp({ store });
  });

  it("reports health without auth", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", service: "construct-server" });
  });

  it("rejects an invalid flow on save", async () => {
    const res = await app.request("/v1/flows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flow: { id: "x", nodes: [] } }),
    });
    expect(res.status).toBe(400);
  });

  it("stores, fetches, and lists flows", async () => {
    const save = await app.request("/v1/flows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Echo", flow: echoFlow() }),
    });
    expect(save.status).toBe(200);
    const stored = (await save.json()) as { id: string; name: string };
    expect(stored.name).toBe("Echo");

    const got = await app.request(`/v1/flows/${stored.id}`);
    expect(got.status).toBe(200);

    const list = (await (await app.request("/v1/flows")).json()) as {
      flows: unknown[];
    };
    expect(list.flows).toHaveLength(1);
  });

  it("runs a stored flow and echoes the input via the fake provider", async () => {
    const save = await app.request("/v1/flows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flow: echoFlow() }),
    });
    const { id } = (await save.json()) as { id: string };

    const run = await app.request("/v1/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flowId: id, input: { message: "hello" } }),
    });
    expect(run.status).toBe(200);
    const record = (await run.json()) as { status: string; output: unknown };
    expect(record.status).toBe("completed");
    expect(record.output).toBe("hello");

    const runs = (await (await app.request("/v1/runs")).json()) as {
      runs: unknown[];
    };
    expect(runs.runs).toHaveLength(1);
  });

  it("runs an inline flow and streams SSE events", async () => {
    const res = await app.request("/v1/runs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ flow: echoFlow(), input: { message: "stream" } }),
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("event: run-start");
    expect(body).toContain("event: run-finish");
    expect(body).toContain("event: run-record");
    expect(body).toContain("stream");
  });

  it("requires a bearer token when an api key is set", async () => {
    const guarded = createApp({ store, apiKey: "secret" });
    const denied = await guarded.request("/v1/flows");
    expect(denied.status).toBe(401);

    const allowed = await guarded.request("/v1/flows", {
      headers: { Authorization: "Bearer secret" },
    });
    expect(allowed.status).toBe(200);
  });

  it("windows the flows list with limit and offset", async () => {
    for (let i = 0; i < 5; i++) {
      await app.request("/v1/flows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ flow: { ...echoFlow(), id: `f${i}` } }),
      });
    }

    const page = (await (
      await app.request("/v1/flows?limit=2&offset=1")
    ).json()) as { flows: unknown[] };
    expect(page.flows).toHaveLength(2);

    const all = (await (await app.request("/v1/flows")).json()) as {
      flows: unknown[];
    };
    expect(all.flows).toHaveLength(5);
  });

  it("rejects a body over the configured limit with 413", async () => {
    const tiny = createApp({ store, maxBodyBytes: 64 });
    const res = await tiny.request("/v1/flows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x".repeat(500), flow: echoFlow() }),
    });
    expect(res.status).toBe(413);
  });
});
