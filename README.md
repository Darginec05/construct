# Construct

Open-source platform for building complex AI agents — deep multi-agent orchestration with a great visual UX.

## Monorepo layout

```
packages/
  dsl/         @construct/dsl        flow schema, types, validation (the contract)
  engine/      @construct/engine     stateful-graph runtime
  nodes/       @construct/nodes       built-in node library
  providers/   @construct/providers   model-provider abstraction
  tools/       @construct/tools       built-in tools + plugin SDK
  rag/         @construct/rag         ingestion, chunking, vector adapters
  sdk/         @construct/sdk         programmatic client
  server/      @construct/server      REST/WS API + persistence
apps/
  editor/      @construct/editor      visual flow editor (React, WIP)
```

## Commands

```bash
yarn install
yarn build      # turbo run build
yarn dev        # turbo run dev
yarn typecheck
```

Requires Node >= 20.

## License

[Apache License 2.0](LICENSE). The open-source engine, DSL, nodes, and editor are
permissively licensed. Construct Cloud (the AI copilot, multi-tenancy, managed
hosting, and collaboration) is a separate, proprietary offering.
