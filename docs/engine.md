# The Engine — `@construct/engine` ✅

The stateful-graph runtime that executes a DSL `Flow`: typed channels with
reducers, expression evaluation, branching, OR-join / `join` barriers, bounded
loops, fan-out `map`, sub-flows, and durable human pauses.

```ts
import { runFlow } from "@construct/engine";

const result = await runFlow(flow, {
  input,            // seeds the input node / initial channels
  initialState,     // pre-populated channel values
  flows,            // Record<id, Flow> — REQUIRED for loop / map / subflow bodies
  maxSteps: 1000,   // global cycle guard (default 1000)
  validate: true,   // assertValidFlow before running (default true)
  onEvent: (e) => …, // stream RunEvents
  onHuman: (node, ctx) => …, // resolve a `human` node inline instead of pausing
});
```

`loop`, `map`, and `subflow` resolve their body by id through `flows`; omit it
and the run fails with `unresolved sub-flow "<id>"`. `onHuman` is optional — when
absent, a `human` node surfaces a durable pause (below); when present, it returns
a `{ patch?, handle? }` decision and the run continues without pausing.

## Execution model

`runFlow` runs the graph as a **worklist over the edges**, not a topo sort —
because the graph has cycles (loops, branch re-entry).

- A node with several incoming edges fires on **ANY** delivery (OR-join). This
  is what loop bodies and branch re-entry rely on.
- A `join` node is the explicit **AND / quorum barrier**: it counts how many of
  its incoming edges have delivered and only fires per its `mode`
  (`all` / `any` / `quorum` with `count`).
- Cycles are bounded by branch conditions *and* a global `maxSteps` guard so a
  runaway flow always terminates.

Control-flow nodes (`input`, `output`, `branch`, `switch`, `loop`, `map`,
`join`, `subflow`) are **intrinsic** to the runner. Leaf nodes resolve through
the executor registry.

## Channels & reducers

State is a set of typed **channels** (LangGraph-style). Nodes read channels via
expressions (`$.name`, `{{name}}`) and write via their `writeTo`. When several
writes land concurrently (e.g. from a `map` fan-out), the channel's **reducer**
makes the result deterministic:

| Reducer | Behaviour |
|---------|-----------|
| `lastValue` | overwrite (default) |
| `append` | push into an array — fan-out collects here |
| `merge` | shallow-merge objects |

Helpers: `initState`, `applyPatch`, `channelMap`. Expression helpers:
`evaluate`, `getByPath`, `truthy`.

## Executors

A leaf node's behaviour is a registered executor:

```ts
registerExecutor(type, (ctx: ExecutorContext) => ExecutorResult | Promise<…>);
registerFunction(name, fn);  // named handlers a `code` node's `ref` resolves to
getExecutor(type); getFunction(name);
```

- **Shipped by the engine:** `transform` (pure expression) and `code` (runs a
  function registered under `ref` via `registerFunction`). These need no external
  deps. ⚠️ A `code` node's `inline` source is accepted by the DSL schema but is
  **not executed in v1** — the executor throws
  `code node: inline source is not supported in v1; use \`ref\``. Use `ref`.
- **Shipped by `@construct/nodes`:** `agent`, `classifier`, `tool`, `retrieve`
  — they need models / tools / vector stores, so they live a layer out. Call
  the package's register function once at startup.

If a node's `type` has no executor and isn't a control-flow node, the run fails
fast with a clear error.

### Per-run injection (providers · tools · prompts)

The engine stays dependency-agnostic: it never knows what a provider, tool, or
prompt *is*. A host injects them per run through `RunOptions`, and executors
resolve them through `ExecutorContext`, falling back to the relevant process
registry when an injection is absent:

```ts
await runFlow(flow, {
  providers: { anthropic: provider }, // ctx.getProvider(id) — per-tenant model keys
  tools:     { lookup: tool },        // ctx.getTool(name)    — per-tenant tools
  prompts:   { "code-reviewer": body }, // ctx.getPrompt(ref) — registry prompt bodies
});
```

This per-run boundary keeps a multi-tenant host (e.g. a cloud runner) from
leaking one tenant's keys/tools/prompts into a process-global registry shared
across runs. For **prompts**: the host resolves each DSL `PromptRef.ref` to a
template body before the run. The
`agent`/`classifier` executors then bind the ref's declared `vars` (each
evaluated against state) and interpolate the body against `{ ...state, ...vars }`
via `ctx.evaluate(body, vars)`. See [dsl.md](./dsl.md#prompt-sources).

## Human pauses

`human` nodes are **durable pauses**. When reached, the run surfaces a pause
(`{ nodeId, exits }`) instead of blocking a thread. The host persists it and
later resumes the flow with the chosen exit handle (e.g. `approved`). This is
how approval gates and multi-turn intake (a `human(collect)` wrapped in a
`loop`) are expressed.

## Events

`onEvent` receives a `RunEvent` stream — the basis for the editor's run-trace
visualization (planned, [editor.md](./editor.md)). The event types are:
`run-start` · `node-start` · `node-finish` · `run-finish` · `paused` ·
`token` (streamed model deltas) · `error`. (There is no per-channel-write
event; channel state is read off the `RunResult`.)

## Result

`runFlow` resolves to a `RunResult`:

```ts
interface RunResult {
  flowId: string;
  status: "completed" | "paused" | "failed";
  state;                              // final channel state
  output?;                            // terminal `output` node value (single or bundle)
  pause?: { nodeId: string; exits: string[] }; // set when status === "paused"
  error?: string;                     // set when status === "failed"
}
```
