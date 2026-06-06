import type { Document, RetrievedDocument, VectorStore } from "./index.js";

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function termCounts(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
}

function norm(counts: Map<string, number>): number {
  return Math.sqrt([...counts.values()].reduce((s, v) => s + v * v, 0));
}

/** Cosine similarity in [0, 1], given precomputed vector norms. */
function cosine(
  a: Map<string, number>,
  aNorm: number,
  b: Map<string, number>,
  bNorm: number,
): number {
  const denom = aNorm * bNorm;
  if (denom === 0) return 0;
  let dot = 0;
  for (const [term, count] of a) dot += count * (b.get(term) ?? 0);
  return dot / denom;
}

/**
 * A dependency-free {@link VectorStore} that scores documents by bag-of-words
 * cosine similarity. It needs no embedding model, so it runs offline and in
 * tests; swap in an embedding-backed store for production retrieval quality.
 */
interface Entry {
  doc: Document;
  counts: Map<string, number>;
  norm: number;
}

export function createMemoryStore(seed: Document[] = []): VectorStore {
  const docs: Entry[] = [];

  const entryOf = (document: Document): Entry => {
    const counts = termCounts(tokenize(document.text));
    return { doc: document, counts, norm: norm(counts) };
  };
  for (const d of seed) docs.push(entryOf(d));

  return {
    async upsert(documents: Document[]): Promise<void> {
      for (const document of documents) {
        const entry = entryOf(document);
        const i = docs.findIndex((d) => d.doc.id === document.id);
        if (i >= 0) docs[i] = entry;
        else docs.push(entry);
      }
    },
    async query(text: string, k = 5): Promise<RetrievedDocument[]> {
      const q = termCounts(tokenize(text));
      const qNorm = norm(q);
      return docs
        .map(({ doc, counts, norm }) => ({
          ...doc,
          score: cosine(q, qNorm, counts, norm),
        }))
        .filter((d) => d.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    },
  };
}
