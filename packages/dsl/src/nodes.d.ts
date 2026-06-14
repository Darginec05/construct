import { z } from "zod";
/**
 * The built-in node catalog. The flow graph itself is open (a node `type` is
 * just a string, so plugins can register their own), but every built-in type
 * ships a typed config schema and a declared set of output handles. The copilot
 * and editor target this catalog; `validateFlow` uses it to check each node's
 * config and the edges leaving it.
 */
export declare const NodeCategorySchema: z.ZodEnum<["io", "model", "control", "data", "tool", "human", "composite"]>;
export type NodeCategory = z.infer<typeof NodeCategorySchema>;
/**
 * A named branch the router can choose. The `description` is what the model
 * actually reads to decide — write it like an instruction to a dispatcher
 * ("billing questions, refunds, charges I don't recognize"), not a bare label.
 */
declare const RouterClassSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name: string;
    description?: string | undefined;
}, {
    name: string;
    description?: string | undefined;
}>;
export type RouterClass = z.infer<typeof RouterClassSchema>;
export interface NodeSpec {
    type: string;
    category: NodeCategory;
    description: string;
    configSchema: z.ZodTypeAny;
    /** Static output handles, or "dynamic" when derived from config. */
    outputs: readonly string[] | "dynamic";
}
/** Register a plugin node type (or override a built-in). */
export declare function registerNodeSpec(spec: NodeSpec): void;
export declare function getNodeSpec(type: string): NodeSpec | undefined;
export declare function listNodeSpecs(): NodeSpec[];
export declare const BUILTIN_NODE_TYPES: string[];
/**
 * Resolve the concrete output handles of a node instance, expanding "dynamic"
 * specs (router classes, switch cases, human modes) from its config.
 */
export declare function resolveNodeOutputs(type: string, config: unknown): string[];
export {};
//# sourceMappingURL=nodes.d.ts.map