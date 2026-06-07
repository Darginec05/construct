<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo-horizontal-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="assets/logo-horizontal-light.svg">
  <img alt="Construct" src="assets/logo-horizontal-light.svg" width="300">
</picture>

# Contributing to Construct

</div>

Thanks for your interest in Construct! This guide covers local setup, the project
conventions, and how to extend the system. By participating you agree to uphold our
[Code of Conduct](CODE_OF_CONDUCT.md).

## Table of contents

- [Ground rules](#ground-rules)
- [Prerequisites](#prerequisites)
- [Local setup](#local-setup)
- [Repository structure](#repository-structure)
- [The mental model](#the-mental-model-the-dsl-is-the-spine)
- [Development workflow](#development-workflow)
- [Coding conventions](#coding-conventions)
- [Extending Construct](#extending-construct)
- [Tests](#tests)
- [Commits & pull requests](#commits--pull-requests)
- [Reporting bugs & proposing features](#reporting-bugs--proposing-features)
- [License](#license)

## Ground rules

- **Keep the DSL stable.** The Flow schema (`@construct/dsl`) is the contract every
  other package depends on. Schema changes ripple everywhere — discuss them in an
  issue before opening a PR, and bump `SCHEMA_VERSION` when the wire format changes.
- **Dependencies point inward.** `engine` depends only on `dsl`. `nodes` may depend
  on `dsl` + `engine` + `providers` + `tools` + `rag`. Nothing depends on the editor.
  Don't introduce an import that violates this.
- **Be honest about status.** If something is a skeleton, mark it 🚧 / 📋 in
  [docs/roadmap.md](docs/roadmap.md) rather than implying it works.
- **Safety is not optional.** Tools carry a tier; write/dangerous actions must be
  gateable through human approval. Don't weaken the tier model to ship a feature.

## Prerequisites

- **Node >= 20** (see [`.nvmrc`](.nvmrc) — `nvm use` picks it up)
- **Yarn 1.x** (this repo pins `yarn@1.22.22` via `packageManager`)

## Local setup

```bash
git clone <your-fork-url>
cd construct
yarn install
yarn build        # build all packages once (turbo respects the dependency graph)
yarn dev          # editor on http://localhost:5173 + watch-mode builds
```

Useful root scripts (all run through [Turborepo](https://turbo.build)):

| Command | What it does |
|---------|--------------|
| `yarn build` | Build every package (`tsc`), respecting `^build` ordering |
| `yarn dev` | Watch builds + run the editor |
| `yarn typecheck` | Type-check the whole workspace |
| `yarn test` | Run the Vitest suites |
| `yarn lint` | Lint (where configured) |
| `yarn clean` | Remove `dist/`, `.turbo/`, build artifacts |

Scope a command to one package with a filter, e.g.
`yarn build --filter=@construct/engine` or run a package script directly inside its
folder (`cd packages/dsl && yarn test`).

## Repository structure

```
packages/
  dsl/         the Flow contract — schema, types, validateFlow (start here)
  engine/      worklist runtime: channels, branch/switch, joins, loops, pauses
  nodes/       executors: agent, classifier, tool, retrieve
  providers/   LLM abstraction: anthropic, openai, gemini, fake
  tools/       Tool contract + registry + tier safety model + built-ins
  rag/         vector-store contract, chunking, in-memory store
  mcp/         MCP adapter (planned)
  sdk/         programmatic client for the server API
  server/      host the engine behind an API
apps/
  editor/      visual flow editor (React + Vite + Tailwind)
docs/          architecture, DSL, engine, nodes, tools, rag, sdk/server, editor
```

## The mental model: the DSL is the spine

A flow is **data** — a versioned, validated `Flow` document. Everything else is a
consumer of that document:

1. **Author** — the editor builds an in-memory graph and serializes it with
   `toDslFlow`.
2. **Validate** — `validateFlow(flow)` returns `ValidationIssue[]` (errors +
   warnings). The editor surfaces these live; the engine asserts them before a run.
3. **Run** — `runFlow(flow, options)` walks the graph as a worklist, threading state
   through typed channels and emitting `RunEvent`s.
4. **Host** — `@construct/server` wraps `runFlow` behind an API; `@construct/sdk`
   calls it.

Control flow (branch, loop, fan-out `map`, join, subflow, human pause) lives in the
**engine**. Anything that touches the outside world (models, tools, retrieval) is a
**leaf** resolved through a registry. Keep that boundary crisp when you add features.

Read [docs/architecture.md](docs/architecture.md) and [docs/dsl.md](docs/dsl.md)
before making structural changes.

## Development workflow

1. **Open an issue first** for anything non-trivial — schema changes, a new node
   type, a new provider, or a behavior change. Small fixes can go straight to a PR.
2. **Branch** off `main`: `git checkout -b feat/short-description`.
3. **Build & test as you go**: `yarn dev` for the editor, `yarn test` for the suites.
4. **Before pushing**, make sure these pass from the repo root:
   ```bash
   yarn typecheck
   yarn test
   ```
5. **Update docs** in `docs/` and the status table in `docs/roadmap.md` when behavior
   changes.

## Coding conventions

- **TypeScript, ESM, strict.** Packages are `"type": "module"` and compile with
  `tsc`. Prefer explicit types at public boundaries.
- **Zod for runtime schemas.** The DSL and tool definitions use Zod; reuse the
  existing patterns (`defineTool(zod)`, the schema converters) rather than hand-rolling
  validation.
- **Small, named exports** over default exports.
- **Comments explain WHY, not WHAT.** Most code shouldn't need a comment; add one only
  for a non-obvious constraint or invariant.
- **No new heavy dependencies** without discussion — this stack is intentionally lean.
- **Match the surrounding style.** There's no bikeshedding config to fight; mirror the
  file you're editing.

## Extending Construct

Common extension points and where they live:

- **A new built-in tool** → `packages/tools`. Use `defineTool` with a Zod schema, set
  the correct `tier` and `requiresApproval`, and register it. Default unknown/external
  tools to a conservative tier.
- **A new model provider** → `packages/providers`. Implement the neutral chat +
  tool-call interface (see `anthropic` / `fake` for reference) and register it by name.
- **A new node executor** → `packages/nodes`. Add the executor, and add its typed
  config schema + declared output handles to the catalog in `packages/dsl` so
  `validateFlow` and the editor understand it.
- **A new vector store** → `packages/rag`. Implement the `VectorStore` contract and
  register it by name.

Whatever you add, wire it through the **registry by name** and reference it from the
DSL — don't hard-code it into the engine.

## Tests

- Tests run with [Vitest](https://vitest.dev). Co-locate them in a package's `test/`
  folder (see `packages/tools/test`, `packages/dsl`).
- Run everything with `yarn test`, or a single package with
  `cd packages/<name> && yarn test`.
- New behavior needs a test. Schema and engine changes especially — they protect the
  contract every other package leans on.
- Use the `fake` provider for deterministic agent/engine tests; don't hit live model
  APIs in the suite.

## Commits & pull requests

- Write clear commit messages that explain the **why**. Conventional-commit prefixes
  (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`) are welcome but not required.
- Keep PRs focused — one logical change per PR is easier to review than a grab-bag.
- In the PR description, include: what changed, why, and how you tested it. Link the
  issue it closes.
- Make sure `yarn typecheck` and `yarn test` pass, and update relevant docs.
- By submitting a PR you agree your contribution is licensed under Apache-2.0 (below).

## Reporting bugs & proposing features

- **Bugs**: open a GitHub issue with steps to reproduce, what you expected, and what
  happened. A minimal flow (the serialized DSL) that triggers it is gold.
- **Features**: open an issue describing the problem first, not just the solution —
  especially for anything that touches the DSL or the safety model.
- **Security**: please report suspected vulnerabilities privately to the maintainers
  rather than opening a public issue.

## License

By contributing, you agree that your contributions will be licensed under the
[Apache License 2.0](LICENSE), the same license that covers this project.
