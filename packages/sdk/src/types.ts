import type { Flow } from "@construct/dsl";
import type { RunFunction } from "@construct/engine";

/**
 * Structural references shared across the builder modules. Kept here (rather than
 * in flow.ts) so builder.ts can refer to a flow / code-node by shape without a
 * runtime import cycle: builder.ts collects these, flow.ts constructs them.
 */

/** A flow usable as a `subflow` / `loop` / `map` body. {@link FlowDefinition} satisfies it. */
export interface FlowRef {
  readonly __kind: "flow";
  readonly id: string;
  toJSON(): Flow;
}

export function isFlowRef(value: unknown): value is FlowRef {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { __kind?: unknown }).__kind === "flow"
  );
}

/** A deterministic handler backing a `code` node, authored with {@link defineNode}. */
export interface NodeDef {
  readonly __kind: "node-def";
  readonly id: string;
  run: RunFunction;
}

export function isNodeDef(value: unknown): value is NodeDef {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { __kind?: unknown }).__kind === "node-def"
  );
}
