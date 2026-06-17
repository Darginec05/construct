# The DSL — `@construct/dsl` ✅

The DSL is the contract between the engine, the editor, and any tool that
generates flows. It is a set of Zod schemas; keep it stable, versioned, and
documented.

```ts
import {
  FlowSchema, validateFlow, listNodeSpecs, resolveNodeOutputs, SCHEMA_VERSION,
} from "@construct/dsl";
```

`SCHEMA_VERSION` is currently `1`.

## Flow

```ts
Flow {
  schemaVersion: 1
  id: string
  name: string
  channels:  Channel[]   // typed shared state (default [])
  resources: Resource[]  // external stateful deps (default [])
  nodes:     Node[]
  edges:     Edge[]
  config:    { defaultModel?: ModelRef; budget?: Budget }
}
```

### Node & Edge

```ts
Node { id: string; type: string; config: Record<string, unknown>; position?: {x,y} }
Edge { id: string; source: string; target: string; sourceHandle?: string; targetHandle? }
```

`position` is editor-only and ignored by the engine. `sourceHandle` selects
which **output handle** an edge leaves from — that is how branching works
(e.g. a `branch` node's `true` / `false` handles).

> **Join semantics.** A node with several incoming edges fires on **ANY** edge
> (OR-join) — exactly what loop / branch re-entry needs. For an AND barrier that
> waits for several parallel branches, route them through a `join` node.

## Primitives

| Type | Definition |
|------|------------|
| `DataType` | `"text" \| "image" \| "file" \| "audio" \| "json" \| "any"` (multimodal port type) |
| `Expr` | a string evaluated against run state. Convention: `$.channel` reads a channel, `{{channel}}` interpolates into a string, a bare literal is used as-is |
| `PromptRef` | `{ ref, vars? }` — a reference to a host-managed prompt, resolved to text at runtime. `vars` is a record of `Expr` bound against run state and interpolated into the resolved body. See [Prompt sources](#prompt-sources) |
| `PromptSource` | `Expr \| PromptRef` — an inline template **or** a registry reference; used for the agent `system`/`prompt` and the router `prompt` |
| `ModelRef` | `{ provider, model, temperature?(0–2), maxTokens?, cache?, params? }` |
| `Budget` | `{ maxTokens?, maxUsd?, maxSteps? }` — cost guardrail, per node/loop/flow |
| `Reducer` | `"lastValue" \| "append" \| "merge"` — how concurrent channel writes combine |
| `Channel` | `{ name, type=DataType, reducer=lastValue, initial?, description? }` |
| `Resource` | `{ name, kind, scope: "run"\|"session", config }` — external dependency with an acquire → use → release lifecycle (sandbox, Figma file, db, vector store) |

## Node catalog

Every built-in ships a typed `configSchema` and a set of output handles
(`outputs`). `"dynamic"` outputs are derived from config at runtime via
`resolveNodeOutputs(type, config)`.

| Type | Category | Key config | Outputs |
|------|----------|-----------|---------|
| `input` | io | `schema`: record `field → DataType` | `out` |
| `output` | io | `from`: `Expr` or record of `Expr` (a named bundle) | — (terminal) |
| `agent` | model | `model`, `system?` (`PromptSource` or an ordered array of them), `prompt?` (`PromptSource`), `tools[]`, `toolChoice` (auto/required/none), `maxSteps`(8), `output` (`"text"` or `{schema}`), `budget?`, `writeTo?` | `out` |
| `classifier` | model | `model`, `prompt?` (`PromptSource`), `classes[]` (≥1), `writeTo?` | **dynamic** — one per class |
| `branch` | control | `condition`: `Expr` | `true`, `false` |
| `switch` | control | `on`: `Expr`, `cases[]` (≥1) | **dynamic** — cases + `default` |
| `loop` | control | `body`: sub-flow id, `until?`, `maxIterations`(5), `budget?`, `writeTo?` | `out` |
| `map` | control | `over`: `Expr`, `body`: sub-flow id, `concurrency`(4), `aggregate` (merge/collect), `writeTo?` | `out` |
| `join` | control | `mode` (all/any/quorum), `count?` (quorum), `writeTo?` | `out` |
| `code` | data | one of `ref` (registered handler) **or** `inline` (source ¹), `writeTo?` | `out` |
| `retrieve` | data | `store`, `query`: `Expr`, `topK`(5), `writeTo?` | `out` |
| `transform` | data | `expr`: `Expr`, `writeTo?` | `out` |
| `tool` | tool | `tool`, `args`: record of `Expr`, `tier?` (read/content/write/bulk/dangerous), `requiresApproval`(false), `resource?`, `writeTo?` | `out` |
| `human` | human | `mode` (approve/select/annotate/collect), `prompt?`, `exits?` (≥1, custom handles), `ttl?`, `writeTo?` | **dynamic** — `approved`/`rejected` for approve, else `next`, or `exits` |
| `subflow` | composite | `flow`: flow id, `inputs`: record of `Expr`, `writeTo?` | `out` |

> ¹ `inline` is accepted by the schema but **not executed by the engine in v1** —
> the `code` executor throws and tells you to use `ref` (a function registered via
> `registerFunction`). See [engine.md](./engine.md#executors).

### Patterns the catalog deliberately does *not* hard-code

- **Evaluator / critic** = an `agent` with structured `output` (e.g.
  `{ pass, issues }`) feeding a `branch`.
- **Reflection / optimizer** = a `loop` whose body re-runs until `until` holds.
- **Dynamic supervisor** = `map(over: tasks) → switch(on: task.type) → subflow`,
  selecting a specialist per item.

`writeTo` appears on most nodes: it stores the node's result into a named state
channel (see [engine.md](./engine.md#channels--reducers)).

## Prompt sources

The agent `system`/`prompt` and the router `prompt` accept a **`PromptSource`** —
either an inline template `Expr`, or a **`PromptRef`** to a prompt managed
*outside* the flow (a host-provided registry). The DSL stays decoupled from any
registry: a `PromptRef` only carries a stable `ref` (id/slug) and `vars`.

```jsonc
{
  "type": "agent",
  "config": {
    "model": { "provider": "anthropic", "model": "claude-..." },
    // A registry persona, layered with a flow-specific addendum.
    "system": [
      { "ref": "code-reviewer", "vars": { "language": "$.lang" } },
      "Keep findings under five bullet points."
    ],
    "prompt": "{{diff}}"
  }
}
```

- **`system`** may be a single `PromptSource` **or an ordered array** of them; the
  parts are resolved and joined with blank lines (registry persona + addendum).
- **`vars`** declares the dynamic values a referenced prompt expects, each an
  `Expr` evaluated against run state. At runtime the host resolves `ref` to a
  template body; the engine binds these vars and interpolates the body against
  `{ ...state, ...vars }`. Declaring vars keeps
  the prompt's contract visible in the flow without inlining the prompt text.

Resolution is the host's job, mirroring per-run `providers`/`tools` injection —
see [engine.md](./engine.md#executors). A `PromptRef` whose `ref` the host does
not resolve fails the node (an inline source with neither prompt nor system only
warns).

## Validation

```ts
validateFlow(flow): ValidationIssue[]
ValidationIssue { level: "error" | "warning"; message: string; nodeId?; edgeId? }
```

It checks each built-in node's `config` against its schema and the edges leaving
it (e.g. an edge using a handle the node doesn't expose). Plugin node types are
skipped unless they register a spec via `registerNodeSpec`.

## Extending the catalog

```ts
registerNodeSpec({ type, category, description, configSchema, outputs });
```

The editor and `validateFlow` immediately pick up registered specs.
