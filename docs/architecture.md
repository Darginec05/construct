# Architecture

## Design goals

1. **One stable contract.** A flow is data — a versioned, validated document
   (`@construct/dsl`). The editor, the engine, and the (cloud) copilot all
   target the same schema, so none of them is privileged.
2. **Open graph, typed built-ins.** Structurally the graph is open: a node
   `type` is any string and `config` is an opaque record, so plugins register
   their own node types. The built-in catalog ships typed config schemas and
   declared output handles, which `validateFlow` and the editor lean on.
3. **Control flow is intrinsic; leaves are pluggable.** Branching, loops,
   fan-out, joins, sub-flows, and human pauses are part of the runtime.
   Everything that touches the outside world (models, tools, retrieval) is a
   leaf resolved through a registry.
4. **Safety is first-class.** Tools carry a tier (read → dangerous); write-class
   actions can be routed through a human approval node before they run.

## Package layers

```
contract      @construct/dsl        Flow / Node / Edge / Channel / Resource schemas + validateFlow
runtime       @construct/engine     executes a Flow: channels, expressions, joins, loops, pauses
leaves        @construct/nodes      agent / classifier / tool / retrieve executors
              @construct/providers  LLM provider abstraction (anthropic, openai, gemini, fake)
              @construct/tools      tool contract + registry (+ MCP / integrations, planned)
              @construct/rag        vector-store contract + chunking + in-memory store
host          @construct/server     run the engine behind an API (+ persistence)
              @construct/sdk        client for that API
authoring     apps/editor           visual flow editor (React)
```

Dependencies point **inward** toward the DSL. `engine` depends only on `dsl`.
`nodes` depends on `dsl` + `engine` + `providers` + `tools` + `rag`. Nothing
depends on the editor.

## Lifecycle of a flow

1. **Author** — the editor builds an in-memory graph and serializes it to a DSL
   `Flow` (`toDslFlow`).
2. **Validate** — `validateFlow(flow)` returns `ValidationIssue[]` (errors +
   warnings). The editor surfaces these live; the engine asserts them before a
   run unless told otherwise.
3. **Run** — `runFlow(flow, options)` walks the graph as a worklist, threading
   shared state through typed channels, and emits `RunEvent`s as it goes.
4. **Host** — `@construct/server` wraps `runFlow` behind `POST /v1/runs`;
   `@construct/sdk` calls it.

See [engine.md](./engine.md) for the execution model and [dsl.md](./dsl.md) for
the contract.

## Scope

Everything needed to author, run, and self-host a flow lives in this repo under
Apache-2.0. A few things are intentionally out of scope here — notably an AI
copilot that generates/edits flows, and multi-tenant managed hosting. That is
why the editor ships a disconnected **Copilot** shell: it is honest that AI edits
run elsewhere and does not fake them. Everything else in the editor (canvas,
inspector, validation, reader view) works fully offline.
