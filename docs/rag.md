# Retrieval — `@construct/rag` 🚧

Ingestion, chunking, and a pluggable vector-store contract behind the DSL
`retrieve` node. A naive in-memory store ships today; production adapters
(pgvector, Qdrant, …) are planned.

```ts
interface Document         { id: string; text: string; metadata?: Record<string, unknown> }
interface RetrievedDocument extends Document { score: number }

interface VectorStore {
  upsert(documents: Document[]): Promise<void>;
  query(text: string, k?: number): Promise<RetrievedDocument[]>;
}
```

## Stores are referenced by name

A `retrieve` node names a `store`; the host registers an implementation under
that name:

```ts
import { registerStore, createMemoryStore } from "@construct/rag";
registerStore("handbook", createMemoryStore());
registerStore(name, store); getStore(name); listStores();
```

This is the same name the editor's `retrieve` inspector field expects. (The OSS
editor has no store registry, so it takes the id as free text — see
[editor.md](./editor.md).)

## Chunking

```ts
chunkText(text, size = 1000, overlap = 200): string[]
```

A fixed-size sliding-window splitter. 🚧 Real ingestion (loaders, embedding
models, metadata extraction) is planned; today `createMemoryStore` is intended
for tests and local experimentation, not production recall quality.

## Status

- ✅ `VectorStore` contract, name registry, `chunkText`, in-memory store.
- 📋 Embedding pipeline, persistent adapters (pgvector / Qdrant), hybrid search.
