import { parseFlow } from "@construct/dsl";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { executeRun } from "./runs.js";
import type { Store } from "./store.js";

export interface AppOptions {
  store: Store;
  /** When set, `/v1/*` requires `Authorization: Bearer <apiKey>`. */
  apiKey?: string;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Build the Hono app for the self-host API. Routes:
 *   GET  /health                 — liveness, unauthenticated
 *   GET    /v1/flows             — list stored flows
 *   POST   /v1/flows             — create/update (validates the document)
 *   GET    /v1/flows/:id         — fetch one
 *   PUT    /v1/flows/:id         — update one
 *   DELETE /v1/flows/:id         — remove one
 *   POST /v1/runs                — execute (JSON, or SSE if Accept asks for it)
 *   GET  /v1/runs[?flowId=]      — list runs
 *   GET  /v1/runs/:id            — fetch one run
 */
export function createApp({ store, apiKey }: AppOptions): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok", service: "construct-server" }));

  if (apiKey) {
    app.use("/v1/*", async (c, next) => {
      if (c.req.header("Authorization") !== `Bearer ${apiKey}`) {
        return c.json({ error: "unauthorized" }, 401);
      }
      await next();
    });
  }

  app.get("/v1/flows", (c) => c.json({ flows: store.listFlows() }));

  app.post("/v1/flows", async (c) => {
    const body = (await c.req.json()) as {
      id?: string;
      name?: string;
      flow: unknown;
    };
    try {
      const flow = parseFlow(body.flow);
      return c.json(store.saveFlow({ id: body.id, name: body.name, flow }));
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.get("/v1/flows/:id", (c) => {
    const stored = store.getFlow(c.req.param("id"));
    return stored ? c.json(stored) : c.json({ error: "flow not found" }, 404);
  });

  app.put("/v1/flows/:id", async (c) => {
    const body = (await c.req.json()) as { name?: string; flow: unknown };
    try {
      const flow = parseFlow(body.flow);
      return c.json(
        store.saveFlow({ id: c.req.param("id"), name: body.name, flow }),
      );
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.delete("/v1/flows/:id", (c) => {
    const ok = store.deleteFlow(c.req.param("id"));
    return ok ? c.json({ deleted: true }) : c.json({ error: "flow not found" }, 404);
  });

  app.post("/v1/runs", async (c) => {
    const body = (await c.req.json()) as {
      flowId?: string;
      flow?: unknown;
      input?: Record<string, unknown>;
    };
    const wantsStream = (c.req.header("Accept") ?? "").includes("text/event-stream");

    if (wantsStream) {
      return streamSSE(c, async (stream) => {
        let chain: Promise<unknown> = Promise.resolve();
        try {
          const record = await executeRun(store, {
            flowId: body.flowId,
            flow: body.flow,
            input: body.input,
            onEvent: (event) => {
              chain = chain.then(() =>
                stream.writeSSE({
                  event: event.type,
                  data: JSON.stringify(event),
                }),
              );
            },
          });
          await chain;
          await stream.writeSSE({ event: "run-record", data: JSON.stringify(record) });
        } catch (err) {
          await chain;
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({ error: errorMessage(err) }),
          });
        }
      });
    }

    try {
      const record = await executeRun(store, {
        flowId: body.flowId,
        flow: body.flow,
        input: body.input,
      });
      return c.json(record);
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.get("/v1/runs", (c) =>
    c.json({ runs: store.listRuns(c.req.query("flowId")) }));

  app.get("/v1/runs/:id", (c) => {
    const run = store.getRun(c.req.param("id"));
    return run ? c.json(run) : c.json({ error: "run not found" }, 404);
  });

  return app;
}
