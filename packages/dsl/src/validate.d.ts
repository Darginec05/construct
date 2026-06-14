import type { Flow } from "./flow.js";
/**
 * Semantic validation, layered on top of the structural `parseFlow`. It checks
 * each node's config against the catalog, that edges connect real nodes and
 * valid handles, that resource references resolve, and that every `$.x` /
 * `{{x}}` reference names a variable the flow actually exposes.
 */
export interface ValidationIssue {
    level: "error" | "warning";
    message: string;
    nodeId?: string;
    edgeId?: string;
}
export interface ValidateOptions {
    /**
     * Variable names seeded from the enclosing context, beyond the flow's own
     * registry — e.g. `["item", "index"]` when validating a loop/map body.
     */
    scopeVariables?: string[];
}
export declare function validateFlow(flow: Flow, opts?: ValidateOptions): ValidationIssue[];
/** Parse-and-validate convenience: throws if there are any error-level issues. */
export declare function assertValidFlow(flow: Flow, opts?: ValidateOptions): void;
//# sourceMappingURL=validate.d.ts.map