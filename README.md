<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo-horizontal-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="assets/logo-horizontal-light.svg">
  <img alt="Construct" src="assets/logo-horizontal-light.svg" width="360">
</picture>

### Build anything. Visual builder for complex AI agents.

Deep multi-agent orchestration with a great visual UX — author, run, and self-host
the whole thing from one repo.

[![CI](https://github.com/Darginec05/construct/actions/workflows/ci.yml/badge.svg)](https://github.com/Darginec05/construct/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-43853d.svg)](.nvmrc)
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
- **The editor is an embeddable library.** `@construct/editor` exports a single
  `<ConstructEditor>` you drop into any React host; it extends by composition
  (props, slots, a DSL facade) so downstream apps never fork it.

## How the pieces fit

```
   @construct/editor ── <ConstructEditor> embeddable React canvas
   (host: apps/editor)        │ serializes to
                              ▼
                     @construct/dsl  ── the versioned Flow contract
                              │
           ┌──────────────────┼───────────────┐
           ▼                  ▼               ▼
         validate           engine          nodes
                            (runtime)       (agent / classifier / tool / retrieve)
                                                │ uses
                                  ┌─────────────┼──────────────┐
                                  ▼             ▼               ▼
                              providers       tools            rag
                              (LLMs)          (+ MCP)          (vector stores)

   @construct/sdk    — fluent SDK to author flows in code (compiles to the contract)
   @construct/server — host the engine behind a REST API + SSE + persistence
   @construct/client — programmatic client for that API
```

## Getting Started

### Prerequisites

- **Node >= 22** (`.nvmrc` pins the version — `nvm use` if you have nvm)
- **Yarn 1.x** (the repo is a Yarn + Turborepo monorepo)

### Install & run

```bash
git clone https://github.com/Darginec05/construct.git
cd construct
yarn install
yarn dev          # turbo run dev — starts the editor playground + watch builds
```

`yarn dev` brings up the visual editor at **http://localhost:5173** (the
`apps/editor` playground host). The canvas, inspector, live validation, and reader
view work out of the box against a simulated model provider — no API keys required
to explore.

Common workspace tasks (all via Turborepo):

```bash
yarn build        # build every package
yarn typecheck    # type-check the whole monorepo
yarn test         # run the test suites
yarn lint
```

### Connect a self-host server (optional)

By default the editor is a pure sandbox: runs use a simulated provider and
**Publish is disabled**. To target a real self-hosted engine
(`@construct/server`), point the playground at it via build-time env. Copy
`apps/editor/.env.example` to `apps/editor/.env` and set:

```bash
VITE_CONSTRUCT_SERVER_URL=http://localhost:8787
VITE_CONSTRUCT_API_KEY=secret   # only if the server requires a token
```

> The **host** (`apps/editor`) is the only place that reads env. The
> `@construct/editor` library never touches `VITE_*` — the host constructs a
> `ConstructClient` and injects it, so no key is ever baked into the library
> bundle.

### Embed the editor in your own app

`@construct/editor` exports one component plus a DSL facade. The host owns the
server connection, the initial flows, and persistence; the editor owns the canvas.

```tsx
import { ConstructEditor, type WorkspaceFlowInput, type WorkspaceFlow } from "@construct/editor";
import "@construct/editor/styles.css";

const initialFlows: WorkspaceFlowInput[] = [
  {
    kind: "main",
    flow: {
      id: "main",
      name: "Assistant",
      nodes: [
        { id: "in", type: "input", config: { schema: { message: "text" } }, position: { x: 0, y: 120 } },
        { id: "ag", type: "agent", config: { model: { provider: "anthropic", model: "claude-sonnet-4-6" }, prompt: "{{ $.message }}", writeTo: "reply" }, position: { x: 320, y: 120 } },
        { id: "out", type: "output", config: { from: "$.reply" }, position: { x: 640, y: 120 } },
      ],
      edges: [
        { id: "e1", source: "in", target: "ag" },
        { id: "e2", source: "ag", target: "out" },
      ],
    },
  },
];

export function App() {
  return (
    <ConstructEditor
      client={null}                                  // null = sandbox; inject a ConstructClient to enable Publish
      initialFlows={initialFlows}                     // uncontrolled seed, read once at mount
      onFlowChange={(flow: WorkspaceFlow) => save(flow)} // debounced, per changed flow, speaks DSL
    />
  );
}
```

Tailwind hosts can pull in the editor's design tokens via the shipped preset:

```js
// tailwind.config.js
import editorPreset from "@construct/editor/tailwind-preset";

export default {
  presets: [editorPreset],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
};
```

**Extension seams.** The editor exposes two stable seams so downstream apps (e.g.
a hosted copilot) extend it without forking:

- **`slots.copilot`** — a mount point that replaces the right-dock "Copilot" tab.
  Pass your own panel; it renders *inside* the editor's provider tree, so it can
  drive the canvas.
- **`useEditorApi()`** — a facade over the canvas that speaks the canonical DSL:
  `getActiveFlow(): Flow`, `applyFlow(flow)` (one undo commit + revalidate),
  `focusNode(id)`, `getIssues()`.

```tsx
import { ConstructEditor, useEditorApi } from "@construct/editor";

function MyCopilot() {
  const api = useEditorApi();
  // read the active flow as DSL, send it somewhere, then apply a patched flow back
  const flow = api.getActiveFlow();
  // ...
  // api.applyFlow(patchedFlow);
}

<ConstructEditor client={null} slots={{ copilot: <MyCopilot /> }} />;
```

## Author a flow in code

Flows are usually drawn on the canvas, but `@construct/sdk` lets you build the same
contract fluently in TypeScript. Declare channels, chain nodes (edges auto-wire),
then `toJSON()` to the document the editor stores — or `run()` it locally.

```ts
import { anthropic, defineFlow } from "@construct/sdk";

export const echo = defineFlow("echo", "Echo agent", (f) => {
  const message = f.text("message");
  const reply = f.text("reply");

  f.input({ channel: message })
    .agent({ model: anthropic("claude-sonnet-4-6"), prompt: message, writeTo: reply })
    .to(f.output(reply));
});

const doc = echo.toJSON();              // canonical Flow — round-trips to the canvas
const result = await echo.run({ message: "hi" }); // execute locally
```

See [`packages/sdk/examples`](packages/sdk/examples) for production-shaped flows
(CRM agent, code agent, website builder) authored this way.

## Monorepo layout

```
packages/
  dsl/         @construct/dsl         flow schema, types, validation (the contract)
  engine/      @construct/engine      stateful-graph runtime
  nodes/       @construct/nodes       built-in node library (executors)
  providers/   @construct/providers   model-provider abstraction
  tools/       @construct/tools       tool contract + registry + built-ins
  rag/         @construct/rag         ingestion, chunking, vector adapters
  mcp/         @construct/mcp         MCP client + tool adapter
  sdk/         @construct/sdk         fluent SDK to author flows in code
  client/      @construct/client      programmatic client for the server API
  server/      @construct/server      REST API + SSE streaming + persistence
  editor/      @construct/editor      embeddable <ConstructEditor> React library
apps/
  editor/      @construct/playground  thin host that mounts <ConstructEditor> (owns env, demo flows)
  docs/        @construct/docs         documentation site
```

Dependencies point **inward** toward the DSL. `engine` depends only on `dsl`;
`nodes` depends on `dsl` + `engine` + `providers` + `tools` + `rag`. The
`@construct/editor` library is consumed *from source* inside the monorepo
(`exports["."] = "./src/index.ts"`); nothing the runtime depends on imports the
editor.

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
| `@construct/sdk` | ✅ Fluent authoring SDK: `defineFlow`/`defineTool`/`defineNode`, compiles to the contract, runs locally |
| `@construct/client` | ✅ Thin client: `run`, `runStream` (SSE), `saveFlow` |
| `@construct/server` | ✅ Hono REST API (flows CRUD, runs, SSE streaming), bearer auth, in-memory + SQLite stores |
| `@construct/mcp` | ✅ MCP client + adapter mounting MCP server tools into the registry |
| `@construct/editor` | 🚧 Embeddable `<ConstructEditor>`: canvas, inspector, live validation, reader view; `slots.copilot` + `useEditorApi()` seams; `initialFlows`/`onFlowChange` |
| `apps/editor` (`@construct/playground`) | ✅ Reference host that mounts the editor and owns env + demo flows |

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
scope for this repo; see [architecture.md](docs/architecture.md#scope). The editor
ships the **seams** for that copilot (`slots.copilot`, `useEditorApi()`), but the
copilot implementation itself lives downstream.
