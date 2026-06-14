import { DataTypeSchema } from "./primitives.js";
function asDataType(value) {
    const parsed = DataTypeSchema.safeParse(value);
    return parsed.success ? parsed.data : "any";
}
function writeTargetOf(node) {
    const w = node.config.writeTo;
    return typeof w === "string" && w.length > 0 ? w : undefined;
}
function inputSchemaOf(node) {
    if (node.type !== "input")
        return undefined;
    const schema = node.config.schema;
    return schema && typeof schema === "object" ? schema : undefined;
}
/**
 * The `item` / `index` bindings the engine seeds into a loop or map body
 * (see the engine's `runMap` / loop executor). Concatenated into a body flow's
 * registry by the editor when it knows the flow is a body.
 */
export function loopBodyVariables() {
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
export function flowVariables(flow, opts = {}) {
    const byName = new Map();
    const ensure = (name) => {
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
        if (ch.type !== "any")
            v.type = ch.type;
        if (ch.initial !== undefined)
            v.availableAtStart = true;
        if (ch.description !== undefined)
            v.description = ch.description;
    }
    // 2. Input fields: seeded from the run payload → in scope everywhere.
    for (const node of flow.nodes) {
        const schema = inputSchemaOf(node);
        if (!schema)
            continue;
        for (const [field, type] of Object.entries(schema)) {
            const v = ensure(field);
            v.source = "input";
            v.availableAtStart = true;
            if (v.type === "any")
                v.type = asDataType(type);
        }
    }
    // 3. writeTo producers: who writes the slot mid-run (for upstream reachability).
    for (const node of flow.nodes) {
        const target = writeTargetOf(node);
        if (!target)
            continue;
        const v = ensure(target);
        if (!v.producers.includes(node.id))
            v.producers.push(node.id);
    }
    if (opts.includeLoopBindings) {
        for (const v of loopBodyVariables()) {
            if (!byName.has(v.name))
                byName.set(v.name, v);
        }
    }
    return [...byName.values()];
}
/** The set of variable names a flow exposes — used by reference validation. */
export function flowVariableNames(flow, opts = {}) {
    return new Set(flowVariables(flow, opts).map((v) => v.name));
}
/** Node ids with a directed path to `nodeId` (graph ancestors; cycles included). */
function graphAncestors(nodeId, edges) {
    const incoming = new Map();
    for (const e of edges) {
        const list = incoming.get(e.target);
        if (list)
            list.push(e.source);
        else
            incoming.set(e.target, [e.source]);
    }
    const seen = new Set();
    const stack = [...(incoming.get(nodeId) ?? [])];
    while (stack.length > 0) {
        const u = stack.pop();
        if (u === undefined || seen.has(u))
            continue;
        seen.add(u);
        for (const p of incoming.get(u) ?? [])
            stack.push(p);
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
export function variablesInScope(flow, nodeId, opts = {}) {
    const reachable = nodeId ? graphAncestors(nodeId, flow.edges) : new Set();
    return flowVariables(flow, opts).map((v) => ({
        ...v,
        inScope: v.availableAtStart || v.producers.some((p) => reachable.has(p)),
    }));
}
//# sourceMappingURL=variables.js.map