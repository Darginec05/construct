# Tools, Integrations & MCP

This is how a flow reaches the outside world. Three concentric rings:

```
@construct/tools        the Tool contract + registry  (thin core)
@construct/integrations connectors w/ creds + Resource lifecycle  (planned)
@construct/mcp          mount any MCP server's tools/resources       (planned)
```

All three feed the **same registry**, so a `tool` node (or an `agent`'s
`tools[]`) doesn't care whether a capability is a built-in, a native
integration, or proxied over MCP — it references it by name.

## `@construct/tools` 🚧 — the contract

Today this package is the contract plus an in-process registry; no built-in
tools ship yet.

```ts
interface Tool<Input = unknown, Output = unknown> {
  name: string;
  description: string;
  parameters?: Record<string, unknown>; // JSON Schema advertised to the model
  run(input: Input): Promise<Output>;
}
registerTool(t); getTool(name); listTools();
```

The `agent` and `tool` executors resolve names through `getTool`.

### What it *should* grow into (kept thin, deps = dsl + zod)

1. **A `tier` on the `Tool` itself.** 📋 Today the safety class
   (`read` / `content` / `write` / `bulk` / `dangerous`) lives only on the DSL
   `tool` node. The tool implementation has no inherent danger level, so a tool
   is only as safe as each node that calls it. A tool should declare a default
   `tier` (and `defaultRequiresApproval`); the node may override it. This makes
   the safety model intrinsic, not opt-in.
2. **`defineTool({ input: zodSchema, run })`.** 📋 Derive `parameters`
   (JSON Schema) from a Zod schema, matching how the rest of the project models
   data, instead of hand-writing JSON Schema.
3. **A tiny, safe built-in set.** 📋 `http.fetch` (read), `time/now`,
   `json` / `math` — near-pure, no credentials. Nothing heavier belongs here.

Credentialed, SDK-heavy connectors (GitHub, Slack, Figma, Postgres, S3) do
**not** belong in this package.

## The tier safety model

`tier` + `requiresApproval` encode the read-vs-write distinction:

| Tier | Meaning | Default handling |
|------|---------|------------------|
| `read` / `content` | fetch / inspect | auto-run |
| `write` / `bulk` / `dangerous` | mutate / destroy | route through a `human` approval node first |

A common pattern: a `tool` node with `requiresApproval: true` whose run pauses
the flow at a `human(approve)` gate; on `approved` the call proceeds, on
`rejected` it routes elsewhere.

## `@construct/integrations` 📋 — native connectors

A separate package (or per-connector packages, e.g.
`@construct/integration-github`) that **depend on** `tools` + `dsl`. Each
connector exports:

- one or more **`Tool`s** (with proper tiers), and
- a **Resource provider** bound to a `Resource.kind` (`figma`, `db`,
  `vectorstore`, …) implementing the acquire → use → release lifecycle that
  `Resource.scope` (`run` / `session`) governs.

Keeping these out of the *core* keeps the core light; the connectors themselves
are still open source (Apache-2.0) — the `Tool` + `Resource` code lives in this
repo and you supply your own credentials. Integrations give **depth** — accurate
tiers, real session lifecycles, no subprocess overhead — for the handful of
services that matter most.

## `@construct/mcp` 📋 — the Model Context Protocol bridge

MCP is the highest-leverage extension point: instead of hand-writing dozens of
connectors, mount an entire ecosystem.

### MCP client (phase 1)

Connect to MCP servers (stdio / SSE / HTTP), list their tools and resources,
and **adapt** each into Construct's own abstractions:

- each MCP tool → a `Tool` (its input schema → `parameters`) registered via
  `registerTool`, so flows call it like any other tool;
- each MCP resource → a `Resource` provider.

One adapter buys **breadth**: any MCP server becomes available to a flow.

> **Safety note — this is mandatory.** MCP tools arrive with *no* tier. The
> adapter MUST default an unmapped MCP tool to a conservative tier (e.g.
> `dangerous` → `requiresApproval`) until it is explicitly classified.
> Otherwise an agent could auto-run an unknown third-party write tool. The tier
> model above is exactly what makes mounting arbitrary MCP servers safe.

### MCP server (phase 2)

The symmetric capability: expose a Construct flow *as* an MCP tool, so other
agents and MCP-aware clients can call your flow. Build this after the client.

## Breadth vs depth — the recommendation

- **MCP first** — breadth across the ecosystem for the cost of one adapter.
- **A few native integrations** — depth/polish (GitHub, Figma, Postgres) where
  tier accuracy and a real Resource lifecycle pay off.
- Take both; MCP earlier.
