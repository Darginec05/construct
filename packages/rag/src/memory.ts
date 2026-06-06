import type { Document, RetrievedDocument, VectorStore } from "./index.js";

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function termCounts(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
}

/** Cosine similarity over bag-of-words term counts, in [0, 1]. */
function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  for (const [term, count] of a) dot += count * (b.get(term) ?? 0);
  const norm = (m: Map<string, number>) =>
    Math.sqrt([...m.values()].reduce((s, v) => s + v * v, 0));
  const denom = norm(a) * norm(b);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * A dependency-free {@link VectorStore} that scores documents by bag-of-words
 * cosine similarity. It needs no embedding model, so it runs offline and in
 * tests; swap in an embedding-backed store for production retrieval quality.
 */
export function createMemoryStore(seed: Document[] = []): VectorStore {
  const docs: Array<{ doc: Document; counts: Map<string, number> }> = [];

  const add = (document: Document) =>
    docs.push({ doc: document, counts: termCounts(tokenize(document.text)) });
  for (const d of seed) add(d);

  return {
    async upsert(documents: Document[]): Promise<void> {
      for (const document of documents) {
        const i = docs.findIndex((d) => d.doc.id === document.id);
        if (i >= 0) docs.splice(i, 1);
        add(document);
      }
    },
    async query(text: string, k = 5): Promise<RetrievedDocument[]> {
      const q = termCounts(tokenize(text));
      return docs
        .map(({ doc, counts }) => ({ ...doc, score: cosine(q, counts) }))
        .filter((d) => d.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    },
  };
}
