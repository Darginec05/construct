import { parseFlow } from "@construct/dsl";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { executeRun } from "./runs.js";
import type { ListOptions, Store } from "./store.js";

/** Largest list page a client may request; also the default when unspecified. */
const MAX_PAGE = 200;
/** Default request body cap (1 MiB) — flow documents are small. */
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

export interface AppOptions {
  store: Store;
  /** When set, `/v1/*` requires `Authorization: Bearer <apiKey>`. */
  apiKey?: string;
  /** Max accepted request body in bytes (default 1 MiB). */
  maxBodyBytes?: number;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Read `limit`/`offset` query params, clamped to a safe bounded window. */
function pageOptions(
  limitRaw?: string,
  offsetRaw?: string,
): Required<ListOptions> {
  const limit = Number(limitRaw);
  const offset = Number(offsetRaw);
  return {
    limit:
      Number.isFinite(limit) && limit > 0 ? Math.min(limit, MAX_PAGE) : MAX_PAGE,
    offset: Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0,
  };
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
 *   GET  /v1/runs[?flowId=&limit=&offset=] — list runs
 *   GET  /v1/runs/:id            — fetch one run
 *
 * List routes accept `limit` (default/max {@link MAX_PAGE}) and `offset`, so a
 * client can never make an endpoint serialize unbounded history.
 */
export function createApp({ store, apiKey, maxBodyBytes }: AppOptions): Hono {
  const app = new Hono();

  // The editor is served from a different origin (Vite dev server), so it needs
  // CORS. Registered first, before auth and the body limit, so even a rejected
  // request (401, 413) still carries CORS headers and the browser can read it.
  // Auth carries a Bearer header (not cookies), so a permissive origin is safe.
  app.use(
    "*",
    cors({
      origin: "*",
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    }),
  );

  // Reject oversized bodies before parsing. Flow documents are small; this caps
  // memory a single request can pin and blunts trivial DoS on an exposed deploy.
  app.use(
    "/v1/*",
    bodyLimit({
      maxSize: maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
      onError: (c) => c.json({ error: "request body too large" }, 413),
    }),
  );

  app.get("/health", (c) => c.json({ status: "ok", service: "construct-server" }));

  if (apiKey) {
    app.use("/v1/*", async (c, next) => {
      if (c.req.header("Authorization") !== `Bearer ${apiKey}`) {
        return c.json({ error: "unauthorized" }, 401);
      }
      await next();
    });
  }

  app.get("/v1/flows", (c) =>
    c.json({
      flows: store.listFlows(
        pageOptions(c.req.query("limit"), c.req.query("offset")),
      ),
    }));

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
        // Serialize writes so events keep their emitted order. A write can reject
        // if the client disconnects; swallow it so the chain never produces an
        // unhandled rejection and the run keeps draining to the store.
        let chain: Promise<unknown> = Promise.resolve();
        const write = (event: string, data: string) => {
          chain = chain.then(() => stream.writeSSE({ event, data })).catch(() => {});
        };
        try {
          const record = await executeRun(store, {
            flowId: body.flowId,
            flow: body.flow,
            input: body.input,
            onEvent: (event) => write(event.type, JSON.stringify(event)),
          });
          write("run-record", JSON.stringify(record));
          await chain;
        } catch (err) {
          write("error", JSON.stringify({ error: errorMessage(err) }));
          await chain;
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
    c.json({
      runs: store.listRuns(
        c.req.query("flowId"),
        pageOptions(c.req.query("limit"), c.req.query("offset")),
      ),
    }));

  app.get("/v1/runs/:id", (c) => {
    const run = store.getRun(c.req.param("id"));
    return run ? c.json(run) : c.json({ error: "run not found" }, 404);
  });

  return app;
}
