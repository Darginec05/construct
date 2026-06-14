import type { Flow } from "./flow.js";
import { type DataType, type Reducer } from "./primitives.js";
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
/**
 * The `item` / `index` bindings the engine seeds into a loop or map body
 * (see the engine's `runMap` / loop executor). Concatenated into a body flow's
 * registry by the editor when it knows the flow is a body.
 */
export declare function loopBodyVariables(): FlowVariable[];
/**
 * Derive the variable registry of a single flow. Pure; merges the three
 * sources with this precedence:
 *  - an explicit channel pins `type` (when non-"any"), `reducer`, and `initial`;
 *  - an input field marks the variable seeded-at-start and labels it `input`;
 *  - every `writeTo` of that name is recorded as a producer.
 */
export declare function flowVariables(flow: Flow, opts?: FlowVariablesOptions): FlowVariable[];
/** The set of variable names a flow exposes — used by reference validation. */
export declare function flowVariableNames(flow: Flow, opts?: FlowVariablesOptions): Set<string>;
/** A variable annotated with whether it is in scope at a particular node. */
export interface ScopedVariable extends FlowVariable {
    /** Seeded before the run, or written by a node that can reach `nodeId`. */
    inScope: boolean;
}
/**
 * The flow's variables, each annotated with whether it is in scope at `nodeId`:
 * seeded at start, or produced by a node with a directed path to `nodeId`. A
 * `null` node scopes to start-only. Reachability follows directed edges through
 * cycles, so a loop-carried value counts as in scope — `inScope` is a soft
 * signal for ranking the picker, not a hard filter.
 */
export declare function variablesInScope(flow: Flow, nodeId: string | null, opts?: FlowVariablesOptions): ScopedVariable[];
//# sourceMappingURL=variables.d.ts.map