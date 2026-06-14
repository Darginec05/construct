import { z } from "zod";
/**
 * Leaf schemas shared across the DSL: data types, model/budget references,
 * state channels, and external resources.
 */
/** Port/value data type. Multimodal: a port can carry text, an image, a file, etc. */
export declare const DataTypeSchema: z.ZodEnum<["text", "image", "file", "audio", "json", "any"]>;
export type DataType = z.infer<typeof DataTypeSchema>;
/**
 * An expression/reference, evaluated by the engine against run state.
 * Convention: `$.channelName` reads a channel; `{{channelName}}` interpolates
 * into a string; a bare literal is used as-is. Kept as a string in v1 so the
 * editor and copilot can author it without a custom AST.
 */
export declare const ExprSchema: z.ZodString;
export type Expr = z.infer<typeof ExprSchema>;
export declare const PositionSchema: z.ZodObject<{
    x: z.ZodNumber;
    y: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    x: number;
    y: number;
}, {
    x: number;
    y: number;
}>;
export type Position = z.infer<typeof PositionSchema>;
/**
 * Safety class of a tool, lowest to highest risk. `read`/`content` fetch or
 * inspect and may auto-run; `write`/`bulk`/`dangerous` mutate or destroy and
 * should be gated behind a human approval. Lives here as the single source of
 * truth shared by the DSL `tool` node and the `@construct/tools` contract.
 */
export declare const ToolTierSchema: z.ZodEnum<["read", "content", "write", "bulk", "dangerous"]>;
export type ToolTier = z.infer<typeof ToolTierSchema>;
/** Which model a node should call. `params` carries provider-specific extras. */
export declare const ModelRefSchema: z.ZodObject<{
    provider: z.ZodString;
    model: z.ZodString;
    temperature: z.ZodOptional<z.ZodNumber>;
    maxTokens: z.ZodOptional<z.ZodNumber>;
    /** Enable prompt caching for large/static context blocks. */
    cache: z.ZodOptional<z.ZodBoolean>;
    params: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    provider: string;
    model: string;
    params?: Record<string, unknown> | undefined;
    temperature?: number | undefined;
    maxTokens?: number | undefined;
    cache?: boolean | undefined;
}, {
    provider: string;
    model: string;
    params?: Record<string, unknown> | undefined;
    temperature?: number | undefined;
    maxTokens?: number | undefined;
    cache?: boolean | undefined;
}>;
export type ModelRef = z.infer<typeof ModelRefSchema>;
/** Cost guardrail. Applied per-node, per-loop, or per-flow. */
export declare const BudgetSchema: z.ZodObject<{
    maxTokens: z.ZodOptional<z.ZodNumber>;
    maxUsd: z.ZodOptional<z.ZodNumber>;
    maxSteps: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    maxTokens?: number | undefined;
    maxUsd?: number | undefined;
    maxSteps?: number | undefined;
}, {
    maxTokens?: number | undefined;
    maxUsd?: number | undefined;
    maxSteps?: number | undefined;
}>;
export type Budget = z.infer<typeof BudgetSchema>;
/**
 * How concurrent writes to a state channel combine.
 * - `lastValue`: overwrite (default).
 * - `append`: push into an array (fan-out collects here).
 * - `merge`: shallow-merge objects.
 */
export declare const ReducerSchema: z.ZodEnum<["lastValue", "append", "merge"]>;
export type Reducer = z.infer<typeof ReducerSchema>;
/**
 * A typed slot of shared run state (LangGraph-style). Nodes read channels via
 * expressions and write via their `writeTo`. The reducer makes concurrent
 * writes (e.g. from a map/fan-out) deterministic.
 */
export declare const ChannelSchema: z.ZodObject<{
    name: z.ZodString;
    type: z.ZodDefault<z.ZodEnum<["text", "image", "file", "audio", "json", "any"]>>;
    reducer: z.ZodDefault<z.ZodEnum<["lastValue", "append", "merge"]>>;
    initial: z.ZodOptional<z.ZodUnknown>;
    description: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "text" | "image" | "file" | "audio" | "json" | "any";
    name: string;
    reducer: "lastValue" | "append" | "merge";
    initial?: unknown;
    description?: string | undefined;
}, {
    name: string;
    type?: "text" | "image" | "file" | "audio" | "json" | "any" | undefined;
    reducer?: "lastValue" | "append" | "merge" | undefined;
    initial?: unknown;
    description?: string | undefined;
}>;
export type Channel = z.infer<typeof ChannelSchema>;
/**
 * An external, stateful dependency with a lifecycle (acquire → use → release):
 * a code sandbox, a Figma file session, a DB connection. Nodes bind to it by
 * name. `scope` controls whether it lives for a single run or a longer session.
 */
export declare const ResourceSchema: z.ZodObject<{
    name: z.ZodString;
    /** e.g. "sandbox" | "figma" | "db" | "vectorstore" | plugin id */
    kind: z.ZodString;
    scope: z.ZodDefault<z.ZodEnum<["run", "session"]>>;
    config: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    kind: string;
    scope: "run" | "session";
    config: Record<string, unknown>;
}, {
    name: string;
    kind: string;
    scope?: "run" | "session" | undefined;
    config?: Record<string, unknown> | undefined;
}>;
export type Resource = z.infer<typeof ResourceSchema>;
//# sourceMappingURL=primitives.d.ts.map