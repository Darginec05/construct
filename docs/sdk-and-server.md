# SDK & Server

## `@construct/server` 🚧 — self-hosted API

Hosts the engine behind an API. Today it exposes the core run handler that the
eventual REST endpoint delegates to; the HTTP/WS framework and persistence layer
are not wired yet.

```ts
import { handleRun } from "@construct/server";

const result = await handleRun({ flow, input });
// internally: parseFlow(flow) → runFlow(flow, { initialState: input })
```

- ✅ `handleRun` — validates and runs a flow.
- 📋 HTTP/WS framework (Hono or Fastify), `POST /v1/runs`, run streaming over WS.
- 📋 Persistence: stored flows, run history, and **durable human pauses** (the
  engine surfaces a pause; the server must persist and later resume it — see
  [engine.md](./engine.md#human-pauses)). Ships as a reference adapter
  (single-node SQLite/Postgres) so a self-hosted server is fully functional.

## `@construct/sdk` ✅ (client) — programmatic access

A thin client for a Construct server.

```ts
import { ConstructClient } from "@construct/sdk";

const client = new ConstructClient({ baseUrl: "https://…", apiKey: "…" });
const output = await client.run(flow, { topic: "…" });
// POST {baseUrl}/v1/runs  with Bearer auth when apiKey is set
```

The client contract is stable; it depends on the server exposing `POST
/v1/runs` (🚧 above). Until the server endpoint is live, drive the engine
directly via `runFlow` or `handleRun`.
