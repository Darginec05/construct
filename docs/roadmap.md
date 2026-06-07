# Status & Roadmap

An honest snapshot of every package. ✅ implemented · 🚧 partial · 📋 planned.

## By package

| Package | Status | Where it stands |
|---------|--------|-----------------|
| `@construct/dsl` | ✅ | Full Flow/primitive/node schemas, 15 built-in node specs, `validateFlow`, `resolveNodeOutputs`. `SCHEMA_VERSION = 1`. |
| `@construct/engine` | ✅ | Worklist runner: channels/reducers, expressions, branch/switch, OR-join + `join`, bounded `loop`, fan-out `map`, `subflow`, human pauses. Ships `transform` + `code`. |
| `@construct/nodes` | ✅ | `agent` (tool-use loop), `classifier`, `tool`, `retrieve` executors. |
| `@construct/providers` | ✅ | Anthropic, OpenAI, Gemini, Fake; neutral chat + tool-call interface. |
| `@construct/tools` | ✅ | `Tool` contract (intrinsic `tier` + `requiresApproval`), registry, `defineTool(zod)` with a Zod→JSON Schema converter, graceful `runTool` (error + timeout), opt-in built-ins (`time_now`, `http_fetch`). |
| `@construct/rag` | 🚧 | `VectorStore` contract, name registry, naive `chunkText`, in-memory store. No embeddings/persistent adapters. |
| `@construct/sdk` | ✅ | Thin `ConstructClient.run` → `POST /v1/runs` (needs the server endpoint live). |
| `@construct/server` | 🚧 | `handleRun` only. No HTTP/WS framework, no persistence, no pause resumption. |
| `apps/editor` | 🚧 | Canvas, left/right docks, schema-driven inspector, reader view, live validation. Run / Undo / Publish / Copilot not wired. |
| `@construct/integrations` | 📋 | Not started. Native connectors + Resource providers. |
| `@construct/mcp` | 📋 | Not started. MCP client adapter, then MCP server. |

## Near-term priorities

1. **Tier enforcement** — `Tool.tier`/`requiresApproval` are declared but inert;
   the agent loop runs any registered tool. Wire write/bulk/dangerous through a
   human-approval gate. Safety prerequisite for mounting MCP.
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
