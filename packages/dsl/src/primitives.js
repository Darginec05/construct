import { z } from "zod";
/**
 * Leaf schemas shared across the DSL: data types, model/budget references,
 * state channels, and external resources.
 */
/** Port/value data type. Multimodal: a port can carry text, an image, a file, etc. */
export const DataTypeSchema = z.enum([
    "text",
    "image",
    "file",
    "audio",
    "json",
    "any",
]);
/**
 * An expression/reference, evaluated by the engine against run state.
 * Convention: `$.channelName` reads a channel; `{{channelName}}` interpolates
 * into a string; a bare literal is used as-is. Kept as a string in v1 so the
 * editor and copilot can author it without a custom AST.
 */
export const ExprSchema = z.string();
export const PositionSchema = z.object({
    x: z.number(),
    y: z.number(),
});
/**
 * Safety class of a tool, lowest to highest risk. `read`/`content` fetch or
 * inspect and may auto-run; `write`/`bulk`/`dangerous` mutate or destroy and
 * should be gated behind a human approval. Lives here as the single source of
 * truth shared by the DSL `tool` node and the `@construct/tools` contract.
 */
export const ToolTierSchema = z.enum([
    "read",
    "content",
    "write",
    "bulk",
    "dangerous",
]);
/** Which model a node should call. `params` carries provider-specific extras. */
export const ModelRefSchema = z.object({
    provider: z.string(),
    model: z.string(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
    /** Enable prompt caching for large/static context blocks. */
    cache: z.boolean().optional(),
    params: z.record(z.unknown()).optional(),
});
/** Cost guardrail. Applied per-node, per-loop, or per-flow. */
export const BudgetSchema = z.object({
    maxTokens: z.number().int().positive().optional(),
    maxUsd: z.number().positive().optional(),
    maxSteps: z.number().int().positive().optional(),
});
/**
 * How concurrent writes to a state channel combine.
 * - `lastValue`: overwrite (default).
 * - `append`: push into an array (fan-out collects here).
 * - `merge`: shallow-merge objects.
 */
export const ReducerSchema = z.enum(["lastValue", "append", "merge"]);
/**
 * A typed slot of shared run state (LangGraph-style). Nodes read channels via
 * expressions and write via their `writeTo`. The reducer makes concurrent
 * writes (e.g. from a map/fan-out) deterministic.
 */
export const ChannelSchema = z.object({
    name: z.string(),
    type: DataTypeSchema.default("any"),
    reducer: ReducerSchema.default("lastValue"),
    initial: z.unknown().optional(),
    description: z.string().optional(),
});
/**
 * An external, stateful dependency with a lifecycle (acquire → use → release):
 * a code sandbox, a Figma file session, a DB connection. Nodes bind to it by
 * name. `scope` controls whether it lives for a single run or a longer session.
 */
export const ResourceSchema = z.object({
    name: z.string(),
    /** e.g. "sandbox" | "figma" | "db" | "vectorstore" | plugin id */
    kind: z.string(),
    scope: z.enum(["run", "session"]).default("run"),
    config: z.record(z.unknown()).default({}),
});
//# sourceMappingURL=primitives.js.map