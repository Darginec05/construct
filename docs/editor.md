# The Editor — `apps/editor` 🚧

The visual flow authoring surface. React 18 + Vite + React Flow + Tailwind
(shadcn "zinc" tokens) + lucide icons. It wires to the **real** `@construct/dsl`
package — node specs, validation, and output handles all come from the contract,
not a mock catalog.

## Layout

```
┌── TopBar ───────────────────────────────────────────────────────────┐
│ brand · Workspace / flow-name · Canvas|Reader · validation · ⚙       │
├─────────┬──────────────────────────────────────────┬────────────────┤
│ LeftDock│            Canvas  /  Reader             │   RightDock     │
│ rail +  │                                          │ Copilot|Test|   │
│ panel   │                                          │ Inspector       │
└─────────┴──────────────────────────────────────────┴────────────────┘
```

### Left dock ✅
A 52px icon rail switching a panel: **Node library** (searchable, grouped by
category, drag onto canvas), **Outline** (flat node list), **Flows** (main +
nested sub-flows), **Resources** (Models / Tools / Knowledge *derived from the
flow's node configs* — there is no workspace registry in OSS, so Secrets shows
an honest "not yet wired" hint).

### Canvas ✅
React Flow graph with category-colored custom nodes. Output handles update
**live** from `resolveNodeOutputs(type, config)`, so a `classifier`'s classes or
a `switch`'s cases grow handles as you edit. Drag-drop create, connect, select.

### Reader view ✅
A linearized, plain-English read of the flow (topo-ordered, back-edges flagged)
for review and explanation.

### Right dock
Tabbed **Copilot / Test / Inspector**, auto-switching to Inspector on selection.

- **Inspector** ✅ — schema-driven. It introspects each node's Zod
  `configSchema` and renders design-matched controls: `PillSelect` for enums,
  `Toggle` for booleans, tag editors for string arrays, a structured `ModelRef`
  editor (provider pills + free-text model with per-provider suggestions +
  clamped temperature), key→type rows for `input.schema`, key→expr rows for
  `args`/`inputs`, a nested editor for `budget`, sub-flow pickers for
  `loop`/`map`/`subflow` references, and monospace expression fields. Labels are
  humanized, required-empty fields are flagged, and each field carries help
  text. Complex/unknown types fall back to a safe JSON editor.
- **Test** 🚧 — a real input form derived from the `input` node's `schema`.
  The **Run** button is disabled pending the runtime wiring.
- **Copilot** 🚧 — an honest disconnected shell. It does not fake AI edits; it
  explains that the copilot is out of scope for the OSS editor. Markdown is
  rendered XSS-safely (no `dangerouslySetInnerHTML`).

## Serialization & validation

`toDslFlow(doc)` maps the editor's multi-flow store to a DSL `Flow` — reused for
the live validation pill (`validateFlow`), and the basis for Run and persistence
when those land.

## Status / not yet wired

- 📋 **Run + run-trace** — needs a runtime decision (in-browser engine vs
  `@construct/sdk` against a server). `toDslFlow` is ready for it.
- 📋 **Undo/Redo** — history stack over the flow doc (top-bar buttons stubbed).
- 📋 **Publish** — needs a backend/persistence target.
- 📋 **Copilot** — out of scope for this repo (see
  [architecture.md](./architecture.md#scope)).

> The editor is verified by type-check and build. UI interactions
> (drag, tag editors, sliders, datalists) should be exercised in a browser
> (`yarn dev`) before claiming visual correctness.
