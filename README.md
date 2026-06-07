<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo-horizontal-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="assets/logo-horizontal-light.svg">
  <img alt="Construct" src="assets/logo-horizontal-light.svg" width="360">
</picture>

### Build anything. Visual builder for complex AI agents.

Deep multi-agent orchestration with a great visual UX — author, run, and self-host
the whole thing from one repo.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-43853d.svg)](.nvmrc)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-22e06b.svg)](CONTRIBUTING.md)

[Documentation](docs/README.md) · [Architecture](docs/architecture.md) · [Roadmap](docs/roadmap.md) · [Contributing](CONTRIBUTING.md)

</div>

---

## What is Construct?

Construct is an open-source platform for building complex AI agents. You chain LLM
nodes — orchestrators, routers, tools, retrievers, and sub-agents — into runnable
flows on a visual canvas, then run them locally or self-host the engine behind an
API.

The **DSL is the spine**: a flow is data — a versioned, validated document
(`@construct/dsl`). The editor authors it, `validateFlow` checks it, the engine
executes it, and every extension point (providers, tools, vector stores) is
referenced from it by name. No part of the stack is privileged.

**Design principles**

- **One stable contract.** Editor, engine, and tooling all target the same schema.
- **Open graph, typed built-ins.** Any node `type` is allowed for plugins; the
  built-in catalog ships typed config schemas and declared output handles.
- **Control flow is intrinsic; leaves are pluggable.** Branching, loops, fan-out,
  joins, sub-flows, and human pauses live in the runtime. Models, tools, and
  retrieval are leaves resolved through a registry.
- **Safety is first-class.** Tools carry a tier (read → dangerous); write-class
  actions can be routed through a human-approval node before they run.

## How the pieces fit

```
   Editor (apps/editor) ── visual authoring
              │ serializes to
              ▼
     @construct/dsl  ── the versioned Flow contract
              │
   ┌──────────┼───────────────┐
   ▼          ▼               ▼
 validate   engine          nodes
            (runtime)       (agent / classifier / tool / retrieve)
                                │ uses
                  ┌─────────────┼──────────────┐
                  ▼             ▼               ▼
              providers       tools            rag
              (LLMs)          (+ MCP)          (vector stores)

   @construct/server — host the engine behind a REST/WS API + persistence
   @construct/sdk    — programmatic client for that API
```

## Quick start

```bash
yarn install
yarn build       # turbo run build
yarn dev         # turbo run dev — editor + watch builds
yarn typecheck
yarn test
```

Requires **Node >= 20**.

## Monorepo layout

```
packages/
  dsl/         @construct/dsl         flow schema, types, validation (the contract)
  engine/      @construct/engine      stateful-graph runtime
  nodes/       @construct/nodes       built-in node library (executors)
  providers/   @construct/providers   model-provider abstraction
  tools/       @construct/tools       tool contract + registry + built-ins
  rag/         @construct/rag         ingestion, chunking, vector adapters
  mcp/         @construct/mcp         MCP client/server adapter (planned)
  sdk/         @construct/sdk         programmatic client
  server/      @construct/server      REST/WS API + persistence
apps/
  editor/      visual flow editor (React)
```

Dependencies point **inward** toward the DSL. `engine` depends only on `dsl`;
`nodes` depends on `dsl` + `engine` + `providers` + `tools` + `rag`. Nothing
depends on the editor.

## Status

An honest snapshot — ✅ implemented · 🚧 partial · 📋 planned. See
[roadmap.md](docs/roadmap.md) for detail.

| Package | Status |
|---------|--------|
| `@construct/dsl` | ✅ Full Flow/node schemas, `validateFlow`, `resolveNodeOutputs` |
| `@construct/engine` | ✅ Worklist runner: channels, branch/switch, joins, loops, fan-out, sub-flows, human pauses |
| `@construct/nodes` | ✅ `agent`, `classifier`, `tool`, `retrieve` executors |
| `@construct/providers` | ✅ Anthropic, OpenAI, Gemini, Fake |
| `@construct/tools` | ✅ Tool contract with tiers + approval, registry, built-ins |
| `@construct/rag` | 🚧 Vector-store contract + in-memory store; no embeddings yet |
| `@construct/sdk` | ✅ Thin client → `POST /v1/runs` |
| `@construct/server` | 🚧 `handleRun` only; no HTTP framework or persistence yet |
| `apps/editor` | 🚧 Canvas, inspector, live validation, reader view |
| `@construct/mcp` | 📋 Not started |

## Documentation

| Doc | What it covers |
|-----|----------------|
| [architecture.md](docs/architecture.md) | Big picture, scope, data & control flow |
| [dsl.md](docs/dsl.md) | The Flow contract: schema, node catalog, validation |
| [engine.md](docs/engine.md) | Runtime semantics: channels, joins, loops, pauses |
| [nodes-and-providers.md](docs/nodes-and-providers.md) | Built-in executors and the provider abstraction |
| [tools-integrations-mcp.md](docs/tools-integrations-mcp.md) | Tool contract, tier safety model, MCP |
| [rag.md](docs/rag.md) | Retrieval: documents, chunking, vector stores |
| [sdk-and-server.md](docs/sdk-and-server.md) | Programmatic client and the self-hosted API |
| [editor.md](docs/editor.md) | The visual flow editor (React) |

## Contributing

Contributions are welcome. Start with the [Contributing Guide](CONTRIBUTING.md) for
local setup, the project conventions, and how to add a node, provider, or tool.

## License

[Apache License 2.0](LICENSE) — the engine, DSL, nodes, providers, tools, RAG, SDK,
server, and editor are all permissively licensed. A few things (an AI copilot that
generates/edits flows, and multi-tenant managed hosting) are intentionally out of
scope for this repo; see [architecture.md](docs/architecture.md#scope).
