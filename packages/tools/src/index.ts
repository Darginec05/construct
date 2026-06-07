import type { ToolTier } from "@construct/dsl";
import type { z } from "zod";
import { toJsonSchema } from "./schema.js";

/**
 * A callable tool an agent can invoke. The Plugin SDK builds on this interface.
 *
 * `tier` declares the intrinsic safety class of the tool (see {@link ToolTier});
 * `requiresApproval` lets a tool force a gate regardless of tier. {@link
 * needsApproval} turns these into a yes/no decision (read/content auto-run;
 * write/bulk/dangerous route through human approval), which the agent loop
 * enforces via the engine's approval callback. The standalone `tool` node is not
 * yet gated — author an explicit human-approve node before it.
 */
export interface Tool<Input = unknown, Output = unknown> {
  name: string;
  description: string;
  /** JSON Schema for `run`'s input, advertised to the model. Defaults to an open object. */
  parameters?: Record<string, unknown>;
  /** Intrinsic safety class. read/content auto-run; write/bulk/dangerous gate. */
  tier?: ToolTier;
  /** Force human approval regardless of tier. */
  requiresApproval?: boolean;
  run(input: Input): Output | Promise<Output>;
}

export type { ToolTier };
export { toJsonSchema };

/**
 * Tiers that route through human approval before running. read/content fetch or
 * inspect and auto-run; write/bulk/dangerous mutate or destroy and are gated.
 */
export const DEFAULT_GATED_TIERS: readonly ToolTier[] = [
  "write",
  "bulk",
  "dangerous",
];

/**
 * Whether a tool call must be approved by a human before it runs. A tool opts in
 * explicitly via `requiresApproval`, or implicitly by declaring a gated `tier`.
 * An untiered tool is treated as safe (not gated) — declare a tier to gate it.
 */
export function needsApproval(
  tool: Pick<Tool, "tier" | "requiresApproval">,
  gatedTiers: readonly ToolTier[] = DEFAULT_GATED_TIERS,
): boolean {
  if (tool.requiresApproval) return true;
  return tool.tier != null && gatedTiers.includes(tool.tier);
}

/**
 * Author a tool from a Zod input schema. The schema is used both to derive the
 * advertised JSON Schema `parameters` and to parse/validate raw input before
 * `run`. Pass explicit `parameters` to override the derived schema (e.g. for a
 * shape the converter doesn't cover).
 */
export interface ToolDefinition<I> {
  name: string;
  description: string;
  input?: z.ZodType<I>;
  parameters?: Record<string, unknown>;
  tier?: ToolTier;
  requiresApproval?: boolean;
  run(input: I): unknown | Promise<unknown>;
}

export function defineTool<I = unknown>(spec: ToolDefinition<I>): Tool {
  const input = spec.input;
  const parameters =
    spec.parameters ??
    (input
      ? toJsonSchema(input as unknown as z.ZodTypeAny)
      : { type: "object", properties: {} });
  return {
    name: spec.name,
    description: spec.description,
    parameters,
    tier: spec.tier,
    requiresApproval: spec.requiresApproval,
    run: (raw: unknown) => spec.run(input ? input.parse(raw) : (raw as I)),
  };
}

/**
 * Result of a guarded tool invocation. Errors are returned, not thrown, so an
 * agent loop can feed them back to the model as a `tool` message instead of
 * aborting the whole run.
 */
export type ToolRunResult =
  | { ok: true; output: unknown }
  | { ok: false; error: string };

export async function runTool(
  tool: Tool,
  input: unknown,
  options: { timeoutMs?: number } = {},
): Promise<ToolRunResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  try {
    const output = await withTimeout(
      Promise.resolve(tool.run(input)),
      timeoutMs,
      tool.name,
    );
    return { ok: true, output };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, name: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`tool "${name}" timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeout]);
}

const registry = new Map<string, Tool>();

export function registerTool(tool: Tool): void {
  registry.set(tool.name, tool);
}

export function getTool(name: string): Tool | undefined {
  return registry.get(name);
}

export function listTools(): Tool[] {
  return [...registry.values()];
}

export { registerBuiltinTools, timeNow, createHttpFetchTool } from "./builtins.js";
