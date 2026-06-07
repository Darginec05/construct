# Status & Roadmap

An honest snapshot of every package. ✅ implemented · 🚧 partial · 📋 planned.

## By package

| Package | Status | Where it stands |
|---------|--------|-----------------|
| `@construct/dsl` | ✅ | Full Flow/primitive/node schemas, 15 built-in node specs, `validateFlow`, `resolveNodeOutputs`. `SCHEMA_VERSION = 1`. |
| `@construct/engine` | ✅ | Worklist runner: channels/reducers, expressions, branch/switch, OR-join + `join`, bounded `loop`, fan-out `map`, `subflow`, human pauses, inline tool-approval callback. Ships `transform` + `code`. |
| `@construct/nodes` | ✅ | `agent` (tool-use loop with tier-gated tools), `classifier`, `tool`, `retrieve` executors. |
| `@construct/providers` | ✅ | Anthropic, OpenAI, Gemini, Fake; neutral chat + tool-call interface. |
| `@construct/tools` | ✅ | `Tool` contract (intrinsic `tier` + `requiresApproval`), registry, `defineTool(zod)` with a Zod→JSON Schema converter, graceful `runTool` (error + timeout), opt-in built-ins (`time_now`, `http_fetch`). |
| `@construct/rag` | 🚧 | `VectorStore` contract, name registry, naive `chunkText`, in-memory store. No embeddings/persistent adapters. |
| `@construct/sdk` | ✅ | Thin `ConstructClient.run` → `POST /v1/runs` (needs the server endpoint live). |
| `@construct/server` | 🚧 | `handleRun` only. No HTTP/WS framework, no persistence, no pause resumption. |
| `apps/editor` | 🚧 | Canvas, left/right docks, schema-driven inspector, reader view, live validation. Run / Undo / Publish / Copilot not wired. |
| `@construct/integrations` | 📋 | Not started. Native connectors + Resource providers. |
| `@construct/mcp` | 📋 | Not started. MCP client adapter, then MCP server. |

## Near-term priorities

1. **Tier enforcement** — 🚧 the agent loop now gates write/bulk/dangerous (and
   `requiresApproval`) tools through the engine's `onToolApproval` callback,
   failing safe (deny) when no approver is wired. Remaining: gate the standalone
   `tool` node, and durable pause/resume of an agent mid-loop (today approval is
   resolved inline, like `onHuman`). Safety prerequisite for mounting MCP.
2. **MCP client** — one adapter unlocks the whole MCP ecosystem; default
   unmapped tools to a conservative tier.
   See [tools-integrations-mcp.md](./tools-integrations-mcp.md).
3. **Editor Run + trace** — decide in-browser engine vs server via the SDK;
   `toDslFlow` already serializes the graph.
4. **Server** — pick the HTTP/WS framework, add persistence, and implement
   durable human-pause resume.
5. **RAG** — embedding pipeline + a persistent vector adapter.

## Larger bets

- **`@construct/mcp` server** — expose a Construct flow as an MCP tool (phase 2).
- **Native integrations** — GitHub, Figma, Postgres, with real Resource
  lifecycles and accurate tiers.
- **AI copilot** — flow generation/editing. Out of scope for this repo (see
  [architecture.md](./architecture.md#scope)).

> This file is the single place to track package status — update the ✅/🚧/📋
> markers here as things land, rather than scattering status across docs.
