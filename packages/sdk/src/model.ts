import type { ModelRef } from "@construct/dsl";

/**
 * Model helpers that produce a {@link ModelRef} for a node's `model` field.
 * `anthropic("claude-sonnet-4-6", { cache: true })` reads better than spelling
 * out `{ provider: "anthropic", model: "…", cache: true }` and keeps provider
 * ids consistent with what `@construct/providers` registers.
 */

export interface ModelOptions {
  temperature?: number;
  maxTokens?: number;
  /** Enable prompt caching for large/static context blocks (provider-dependent). */
  cache?: boolean;
  /** Provider-specific extras passed through untouched. */
  params?: Record<string, unknown>;
}

function model(provider: string, name: string, opts: ModelOptions = {}): ModelRef {
  const ref: ModelRef = { provider, model: name };
  if (opts.temperature !== undefined) ref.temperature = opts.temperature;
  if (opts.maxTokens !== undefined) ref.maxTokens = opts.maxTokens;
  if (opts.cache !== undefined) ref.cache = opts.cache;
  if (opts.params !== undefined) ref.params = opts.params;
  return ref;
}

export const anthropic = (name: string, opts?: ModelOptions): ModelRef =>
  model("anthropic", name, opts);

export const openai = (name: string, opts?: ModelOptions): ModelRef =>
  model("openai", name, opts);

export const gemini = (name: string, opts?: ModelOptions): ModelRef =>
  model("gemini", name, opts);

/** Build a ModelRef for any registered provider id (plugins, local models). */
export const provider = (
  id: string,
  name: string,
  opts?: ModelOptions,
): ModelRef => model(id, name, opts);
