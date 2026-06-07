import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import type { Hono } from "hono";
import { createApp } from "./app.js";
import { MemoryStore } from "./store-memory.js";
import { SqliteStore } from "./store-sqlite.js";
import type { Store } from "./store.js";

export interface ServerOptions {
  /** Provide a store directly, bypassing `db`. */
  store?: Store;
  /** SQLite file path. Omit (or use the env default) for an in-memory store. */
  db?: string;
  apiKey?: string;
}

export interface ConstructServer {
  app: Hono;
  store: Store;
}

/**
 * Assemble the app and its store. A `db` path selects the durable
 * `node:sqlite` adapter; otherwise runs are kept in memory and lost on restart.
 */
export function createServer(options: ServerOptions = {}): ConstructServer {
  const store =
    options.store ?? (options.db ? new SqliteStore(options.db) : new MemoryStore());
  const app = createApp({ store, apiKey: options.apiKey });
  return { app, store };
}

/** CLI entry: read config from the environment and start listening. */
export function start(): void {
  const db = process.env.CONSTRUCT_DB;
  const apiKey = process.env.CONSTRUCT_API_KEY;
  const port = Number(process.env.PORT ?? 8787);

  const { app, store } = createServer({ db, apiKey });

  const server = serve({ fetch: app.fetch, port }, (info) => {
    console.log(`construct-server listening on http://localhost:${info.port}`);
    console.log(`  store: ${db ? `sqlite (${db})` : "memory — ephemeral, lost on restart"}`);
    console.log(
      `  auth:  ${apiKey ? "bearer token required" : "open — set CONSTRUCT_API_KEY to require a token"}`,
    );
  });

  // Stop accepting connections, then release the store handle (flushes SQLite).
  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`\n${signal} received — shutting down`);
    server.close(() => {
      store.close?.();
      process.exit(0);
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) start();
