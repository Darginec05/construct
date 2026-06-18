import type { Flow, FlowEdge, FlowNode } from "./flow.js";
import { DataTypeSchema, type DataType, type Reducer } from "./primitives.js";

/**
 * The variable registry: the single source of truth for which named slots of
 * run state a flow exposes, so the editor, the variable picker, and validation
 * never force authors to hand-sync the same name across an input field, a
 * channel, and every `$.name` that reads it.
 *
 * A flow's variables are *derived*, not declared in one place — they come from
 * three sources that all land in the same flat `RunState` bag the engine reads:
 *
 *  - an input node's `schema` fields (seeded from the run payload),
 *  - any node's `writeTo` target (produced mid-run),
 *  - an explicit `flow.channels` entry (which additionally pins a reducer /
 *    initial value).
 *
 * This mirrors the engine exactly: `$.x` / `{{x}}` resolve against state keys,
 * regardless of which of the three put the key there. The registry is per-flow
 * — a sub-flow (including a loop/map body) has its own, matching the engine's
 * explicit-boundary semantics.
 */

/**
 * Where a variable enters scope. Drives the picker's grouping/icon and the
 * "defines a variable" affordance on the input node.
 * - `input`    — a field of an input node's `schema`.
 * - `channel`  — an explicitly declared `flow.channels` entry.
 * - `produced` — written by a node via `writeTo` (no input/channel of that name).
 * - `loop`     — the `item` / `index` bindings the engine seeds into a loop/map body.
 */
export type VariableSource = "input" | "channel" | "produced" | "loop";

/**
 * A named slot of run state, readable via `$.name` / `{{name}}`. Derived by
 * {@link flowVariables}.
 */
export interface FlowVariable {
  name: string;
  /** Best-known data type; "any" when nothing pins it. */
  type: DataType;
  /** Channel reducer; "lastValue" unless an explicit channel overrides it. */
  reducer: Reducer;
  /** Primary origin, for labeling. A variable can have several sources at once. */
  source: VariableSource;
  /** Node ids that write this variable — used for upstream-aware reachability. */
  producers: string[];
  /**
   * Seeded before the first node runs (an input field, or a channel with an
   * `initial`), so it is in scope everywhere — no upstream writer required.
   */
  availableAtStart: boolean;
  description?: string;
}

export interface FlowVariablesOptions {
  /**
   * Include the `item` / `index` bindings the engine injects into a loop/map
   * body. Set this when the flow being inspected is used as a `body`.
   */
  includeLoopBindings?: boolean;
}

function asDataType(value: unknown): DataType {
  const parsed = DataTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : "any";
}

/**
 * Variable names a node produces into state. Every node may write `writeTo`; a
 * router additionally writes its rationale into `reasonTo` when set.
 */
function writeTargetsOf(node: FlowNode): string[] {
  const cfg = node.config as Record<string, unknown>;
  const out: string[] = [];
  for (const key of ["writeTo", "reasonTo"] as const) {
    const v = cfg[key];
    if (typeof v === "string" && v.length > 0) out.push(v);
  }
  return out;
}

function inputSchemaOf(node: FlowNode): Record<string, unknown> | undefined {
  if (node.type !== "input") return undefined;
  const schema = (node.config as Record<string, unknown>).schema;
  return schema && typeof schema === "object" ? (schema as Record<string, unknown>) : undefined;
}

/**
 * The `item` / `index` bindings the engine seeds into a loop or map body
 * (see the engine's `runMap` / loop executor). Concatenated into a body flow's
 * registry by the editor when it knows the flow is a body.
 */
export function loopBodyVariables(): FlowVariable[] {
  return [
    { name: "item", type: "any", reducer: "lastValue", source: "loop", producers: [], availableAtStart: true },
    { name: "index", type: "any", reducer: "lastValue", source: "loop", producers: [], availableAtStart: true },
  ];
}

/**
 * Derive the variable registry of a single flow. Pure; merges the three
 * sources with this precedence:
 *  - an explicit channel pins `type` (when non-"any"), `reducer`, and `initial`;
 *  - an input field marks the variable seeded-at-start and labels it `input`;
 *  - every `writeTo` of that name is recorded as a producer.
 */
export function flowVariables(flow: Flow, opts: FlowVariablesOptions = {}): FlowVariable[] {
  const byName = new Map<string, FlowVariable>();

  const ensure = (name: string): FlowVariable => {
    let v = byName.get(name);
    if (!v) {
      v = { name, type: "any", reducer: "lastValue", source: "produced", producers: [], availableAtStart: false };
      byName.set(name, v);
    }
    return v;
  };

  // 1. Explicit channels: the only source of a non-default reducer / initial.
  for (const ch of flow.channels) {
    const v = ensure(ch.name);
    v.source = "channel";
    v.reducer = ch.reducer;
    if (ch.type !== "any") v.type = ch.type;
    if (ch.initial !== undefined) v.availableAtStart = true;
    if (ch.description !== undefined) v.description = ch.description;
  }

  // 2. Input fields: seeded from the run payload → in scope everywhere.
  for (const node of flow.nodes) {
    const schema = inputSchemaOf(node);
    if (!schema) continue;
    for (const [field, descriptor] of Object.entries(schema)) {
      const v = ensure(field);
      v.source = "input";
      v.availableAtStart = true;
      // A descriptor is either the shorthand `"text"` or `{ type, ... }`.
      const declared =
        typeof descriptor === "string"
          ? descriptor
          : (descriptor as { type?: unknown } | null)?.type;
      if (v.type === "any") v.type = asDataType(declared);
    }
  }

  // 3. writeTo producers: who writes the slot mid-run (for upstream reachability).
  for (const node of flow.nodes) {
    for (const target of writeTargetsOf(node)) {
      const v = ensure(target);
      if (!v.producers.includes(node.id)) v.producers.push(node.id);
    }
  }

  if (opts.includeLoopBindings) {
    for (const v of loopBodyVariables()) {
      if (!byName.has(v.name)) byName.set(v.name, v);
    }
  }

  return [...byName.values()];
}

/** The set of variable names a flow exposes — used by reference validation. */
export function flowVariableNames(flow: Flow, opts: FlowVariablesOptions = {}): Set<string> {
  return new Set(flowVariables(flow, opts).map((v) => v.name));
}

/** A variable annotated with whether it is in scope at a particular node. */
export interface ScopedVariable extends FlowVariable {
  /** Seeded before the run, or written by a node that can reach `nodeId`. */
  inScope: boolean;
}

/** Node ids with a directed path to `nodeId` (graph ancestors; cycles included). */
function graphAncestors(nodeId: string, edges: readonly FlowEdge[]): Set<string> {
  const incoming = new Map<string, string[]>();
  for (const e of edges) {
    const list = incoming.get(e.target);
    if (list) list.push(e.source);
    else incoming.set(e.target, [e.source]);
  }
  const seen = new Set<string>();
  const stack = [...(incoming.get(nodeId) ?? [])];
  while (stack.length > 0) {
    const u = stack.pop();
    if (u === undefined || seen.has(u)) continue;
    seen.add(u);
    for (const p of incoming.get(u) ?? []) stack.push(p);
  }
  return seen;
}

/**
 * The flow's variables, each annotated with whether it is in scope at `nodeId`:
 * seeded at start, or produced by a node with a directed path to `nodeId`. A
 * `null` node scopes to start-only. Reachability follows directed edges through
 * cycles, so a loop-carried value counts as in scope — `inScope` is a soft
 * signal for ranking the picker, not a hard filter.
 */
export function variablesInScope(
  flow: Flow,
  nodeId: string | null,
  opts: FlowVariablesOptions = {},
): ScopedVariable[] {
  const reachable = nodeId ? graphAncestors(nodeId, flow.edges) : new Set<string>();
  return flowVariables(flow, opts).map((v) => ({
    ...v,
    inScope: v.availableAtStart || v.producers.some((p) => reachable.has(p)),
  }));
}
