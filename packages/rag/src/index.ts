export interface Document {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface RetrievedDocument extends Document {
  score: number;
}

/** Pluggable vector store backend (in-memory, pgvector, Qdrant, ...). */
export interface VectorStore {
  upsert(documents: Document[]): Promise<void>;
  query(text: string, k?: number): Promise<RetrievedDocument[]>;
}

/** Split raw text into chunks for embedding. Naive fixed-size splitter for now. */
export function chunkText(text: string, size = 1000, overlap = 200): string[] {
  const chunks: string[] = [];
  const step = Math.max(1, size - overlap);
  for (let start = 0; start < text.length; start += step) {
    chunks.push(text.slice(start, start + size));
  }
  return chunks;
}
