import type { ToolTier } from "@construct/dsl";
import { toJsonSchema } from "./schema.js";

/**
 * A callable tool an agent can invoke. The Plugin SDK builds on this interface.
 *
 * `tier` declares the intrinsic safety class of the tool (see {@link ToolTier});
 * `requiresApproval` lets a tool force a gate regardless of tier. {@link
 * needsApproval} turns these into a yes/no decision (read/content auto-run;
 * write/bulk/dangerous route through human approval), which both the agent loop
 * and the standalone `tool` node enforce via the engine's approval callback.
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

/** Tool tiers ordered low -> high risk, matching the DSL `ToolTier` enum. */
const TIER_ORDER: readonly ToolTier[] = ["read", "content", "write", "bulk", "dangerous"];

/**
 * The higher-risk of two tiers, treating `undefined` as the lowest risk. Used to
 * let a `tool` node *escalate* — never relax — the registered tool's intrinsic
 * tier: the stricter classification always wins, so a node setting can raise the
 * gate on a specific call but can't ungate an intrinsically dangerous tool.
 */
export function higherTier(
  a: ToolTier | undefined,
  b: ToolTier | undefined,
): ToolTier | undefined {
  if (a == null) return b;
  if (b == null) return a;
  return TIER_ORDER.indexOf(a) >= TIER_ORDER.indexOf(b) ? a : b;
}

export {
  defineTool,
  registerTool,
  getTool,
  listTools,
  type ToolDefinition,
} from "./tool-base.js";

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

export { registerBuiltinTools, timeNow, createHttpFetchTool } from "./builtins.js";
