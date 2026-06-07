# Construct — Documentation

Construct is an open-source platform for building complex AI agents: deep
multi-agent orchestration with a great visual UX. Self-host the whole thing —
engine, editor, server — from this repo.

## How the pieces fit

```
            ┌──────────────────────────────────────────────┐
            │  Editor (apps/editor)  ──── visual authoring  │
            └───────────────┬──────────────────────────────┘
                            │ serializes to
                            ▼
                   ┌──────────────────┐
                   │  @construct/dsl  │  the versioned Flow contract
                   └────────┬─────────┘
              validates │   │   │ describes
                        ▼   ▼   ▼
   ┌──────────────┐  ┌──────────────────┐  ┌────────────────────┐
   │ @construct/  │  │ @construct/engine│  │ @construct/nodes   │
   │ validate     │  │ graph runtime    │◄─┤ model/tool/retrieve│
   └──────────────┘  └───────┬──────────┘  │ executors          │
                             │             └─────────┬──────────┘
                  resolves leaf nodes via            │ uses
                             │              ┌─────────┴──────────┐
                             ▼              ▼                    ▼
                     ┌──────────────┐ ┌──────────────┐  ┌──────────────┐
                     │ providers    │ │ tools (+ MCP │  │ rag          │
                     │ (LLMs)       │ │ + integr.)   │  │ vector stores│
                     └──────────────┘ └──────────────┘  └──────────────┘

   @construct/server  — host the engine behind a REST/WS API + persistence
   @construct/sdk     — programmatic client for that API
```

The **DSL is the spine**: the editor authors it, `validateFlow` checks it, the
engine executes it, and every extension point (providers, tools, stores) is
referenced from it by name.

## Documentation map

| Doc | What it covers |
|-----|----------------|
| [architecture.md](./architecture.md) | The big picture, scope, data & control flow |
| [dsl.md](./dsl.md) | The Flow contract: schema, primitives, the full node catalog, validation |
| [engine.md](./engine.md) | Runtime semantics: worklist, channels/reducers, joins, loops, human pauses |
| [nodes-and-providers.md](./nodes-and-providers.md) | Built-in executors and the model-provider abstraction |
| [tools-integrations-mcp.md](./tools-integrations-mcp.md) | The tool contract, the tier safety model, integrations, and **MCP** |
| [rag.md](./rag.md) | Retrieval: documents, chunking, vector stores |
| [sdk-and-server.md](./sdk-and-server.md) | Programmatic client and the self-hosted API |
| [editor.md](./editor.md) | The visual flow editor (React) |
| [roadmap.md](./roadmap.md) | Honest status of every package and what's planned |

## Status legend

Used throughout these docs:

- ✅ **Implemented** — works today.
- 🚧 **Partial** — contract/skeleton exists, behaviour incomplete.
- 📋 **Planned** — designed, not built yet.

## Running it

```bash
yarn install
yarn build       # turbo run build
yarn dev         # turbo run dev (editor + watch builds)
yarn typecheck
```

Requires Node >= 20.

## License

[Apache-2.0](../LICENSE). The engine, DSL, nodes, providers, tools, RAG, SDK,
server, and editor are all permissively licensed. A few things (an AI copilot,
multi-tenant managed hosting) are out of scope for this repo — see
[architecture.md](./architecture.md#scope).
