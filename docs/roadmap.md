# Status & Roadmap

An honest snapshot of every package. ✅ implemented · 🚧 partial · 📋 planned.

## By package

| Package | Status | Where it stands |
|---------|--------|-----------------|
| `@construct/dsl` | ✅ | Full Flow/primitive/node schemas, 15 built-in node specs, `validateFlow`, `resolveNodeOutputs`. `SCHEMA_VERSION = 1`. |
| `@construct/engine` | ✅ | Worklist runner: channels/reducers, expressions, branch/switch, OR-join + `join`, bounded `loop`, fan-out `map`, `subflow`, human pauses, inline tool-approval callback. Ships `transform` + `code`. |
| `@construct/nodes` | ✅ | `agent` (tool-use loop with tier-gated tools), `classifier`, `tool` (tier-gated), `retrieve` executors. |
| `@construct/providers` | ✅ | Anthropic, OpenAI, Gemini, Fake; neutral chat + tool-call interface. |
| `@construct/tools` | ✅ | `Tool` contract (intrinsic `tier` + `requiresApproval`), registry, `defineTool(zod)` with a Zod→JSON Schema converter, graceful `runTool` (error + timeout), opt-in built-ins (`time_now`, `http_fetch`). |
| `@construct/rag` | 🚧 | `VectorStore` contract, name registry, naive `chunkText`, in-memory store. No embeddings/persistent adapters. |
| `@construct/sdk` | ✅ | Thin `ConstructClient`: `run` → `POST /v1/runs`, `saveFlow` → `POST /v1/flows` (upsert by id). |
| `@construct/server` | 🚧 | Hono REST API: flow CRUD, `POST /v1/runs` (JSON + SSE), run history; `Store` with memory + `node:sqlite` adapters; lazy provider registration; optional Bearer auth. No durable human-pause resume. |
| `apps/editor` | 🚧 | Canvas, left/right docks, schema-driven inspector, reader view, live validation, Run + trace, Undo/Redo, Publish (→ `@construct/server` via `VITE_CONSTRUCT_SERVER_URL`). Copilot out of scope (cloud). |
| `@construct/integrations` | 📋 | Not started. Native connectors + Resource providers. |
| `@construct/mcp` | 🚧 | MCP **client**: `McpClient` mounts any server's tools into the registry (`inputSchema`→`parameters`), defaulting unclassified tools to `dangerous` + `requiresApproval` (overridable via `tierFor`). MCP **server** not started. |

## Near-term priorities

1. **Tier enforcement** — 🚧 both the agent loop and the standalone `tool` node
   gate write/bulk/dangerous (and `requiresApproval`) tools through the engine's
   `onToolApproval` callback, failing safe (deny) when no approver is wired.
   Remaining: durable pause/resume of an agent mid-loop (today approval is
   resolved inline, like `onHuman`).
2. **MCP client** — ✅ `@construct/mcp` adapts any MCP server's tools into the
   registry, defaulting unmapped tools to a conservative tier so they can't
   auto-run. See [tools-integrations-mcp.md](./tools-integrations-mcp.md).
3. **Editor Run + trace** — decide in-browser engine vs server via the SDK;
   `toDslFlow` already serializes the graph.
4. **Server** — ✅ Hono REST API with flow CRUD, runs (JSON + SSE), and a
   `Store` (memory + `node:sqlite`). Remaining: durable human-pause resume
   (blocked on engine state snapshots) and wiring the editor's Publish to it.
5. **RAG** — embedding pipeline + a persistent vector adapter.

## Larger bets

- **`@construct/mcp` server** — expose a Construct flow as an MCP tool (phase 2).
- **Native integrations** — GitHub, Figma, Postgres, with real Resource
  lifecycles and accurate tiers.
- **AI copilot** — flow generation/editing. Out of scope for this repo (see
  [architecture.md](./architecture.md#scope)).

> This file is the single place to track package status — update the ✅/🚧/📋
> markers here as things land, rather than scattering status across docs.
