import { z } from "zod";
/**
 * The flow DSL is the contract between the OSS engine, the editor, and the
 * (cloud) copilot. Keep it stable, versioned, and well-documented.
 *
 * Structurally the graph is open: a node `type` is any string, and `config`
 * is an opaque record. Built-in types are validated against the node catalog
 * by `validateFlow` (see ./validate); plugins register their own specs.
 */
export declare const SCHEMA_VERSION: 1;
export declare const NodeSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodString;
    config: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    /** Editor-only; ignored by the engine. */
    position: z.ZodOptional<z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        x: number;
        y: number;
    }, {
        x: number;
        y: number;
    }>>;
}, "strip", z.ZodTypeAny, {
    type: string;
    config: Record<string, unknown>;
    id: string;
    position?: {
        x: number;
        y: number;
    } | undefined;
}, {
    type: string;
    id: string;
    config?: Record<string, unknown> | undefined;
    position?: {
        x: number;
        y: number;
    } | undefined;
}>;
export type FlowNode = z.infer<typeof NodeSchema>;
/**
 * A directed connection. A node with several incoming edges fires on ANY edge
 * (OR-join) — which is what loop / branch re-entry relies on. For an AND barrier
 * that waits for multiple parallel branches, route them through a `join` node.
 */
export declare const EdgeSchema: z.ZodObject<{
    id: z.ZodString;
    source: z.ZodString;
    target: z.ZodString;
    /** Which output handle of the source this edge leaves from (branching). */
    sourceHandle: z.ZodOptional<z.ZodString>;
    targetHandle: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    source: string;
    target: string;
    sourceHandle?: string | undefined;
    targetHandle?: string | undefined;
}, {
    id: string;
    source: string;
    target: string;
    sourceHandle?: string | undefined;
    targetHandle?: string | undefined;
}>;
export type FlowEdge = z.infer<typeof EdgeSchema>;
export declare const FlowConfigSchema: z.ZodObject<{
    defaultModel: z.ZodOptional<z.ZodObject<{
        provider: z.ZodString;
        model: z.ZodString;
        temperature: z.ZodOptional<z.ZodNumber>;
        maxTokens: z.ZodOptional<z.ZodNumber>;
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
    }>>;
    budget: z.ZodOptional<z.ZodObject<{
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
    }>>;
}, "strip", z.ZodTypeAny, {
    budget?: {
        maxTokens?: number | undefined;
        maxUsd?: number | undefined;
        maxSteps?: number | undefined;
    } | undefined;
    defaultModel?: {
        provider: string;
        model: string;
        params?: Record<string, unknown> | undefined;
        temperature?: number | undefined;
        maxTokens?: number | undefined;
        cache?: boolean | undefined;
    } | undefined;
}, {
    budget?: {
        maxTokens?: number | undefined;
        maxUsd?: number | undefined;
        maxSteps?: number | undefined;
    } | undefined;
    defaultModel?: {
        provider: string;
        model: string;
        params?: Record<string, unknown> | undefined;
        temperature?: number | undefined;
        maxTokens?: number | undefined;
        cache?: boolean | undefined;
    } | undefined;
}>;
export type FlowConfig = z.infer<typeof FlowConfigSchema>;
export declare const FlowSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodString;
    name: z.ZodString;
    /** Typed shared state with reducers. */
    channels: z.ZodDefault<z.ZodArray<z.ZodObject<{
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
    }>, "many">>;
    /** External stateful dependencies (sandbox, Figma, db). */
    resources: z.ZodDefault<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
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
    }>, "many">>;
    nodes: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        type: z.ZodString;
        config: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        /** Editor-only; ignored by the engine. */
        position: z.ZodOptional<z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            x: number;
            y: number;
        }, {
            x: number;
            y: number;
        }>>;
    }, "strip", z.ZodTypeAny, {
        type: string;
        config: Record<string, unknown>;
        id: string;
        position?: {
            x: number;
            y: number;
        } | undefined;
    }, {
        type: string;
        id: string;
        config?: Record<string, unknown> | undefined;
        position?: {
            x: number;
            y: number;
        } | undefined;
    }>, "many">;
    edges: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        source: z.ZodString;
        target: z.ZodString;
        /** Which output handle of the source this edge leaves from (branching). */
        sourceHandle: z.ZodOptional<z.ZodString>;
        targetHandle: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        source: string;
        target: string;
        sourceHandle?: string | undefined;
        targetHandle?: string | undefined;
    }, {
        id: string;
        source: string;
        target: string;
        sourceHandle?: string | undefined;
        targetHandle?: string | undefined;
    }>, "many">;
    config: z.ZodDefault<z.ZodObject<{
        defaultModel: z.ZodOptional<z.ZodObject<{
            provider: z.ZodString;
            model: z.ZodString;
            temperature: z.ZodOptional<z.ZodNumber>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
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
        }>>;
        budget: z.ZodOptional<z.ZodObject<{
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
        }>>;
    }, "strip", z.ZodTypeAny, {
        budget?: {
            maxTokens?: number | undefined;
            maxUsd?: number | undefined;
            maxSteps?: number | undefined;
        } | undefined;
        defaultModel?: {
            provider: string;
            model: string;
            params?: Record<string, unknown> | undefined;
            temperature?: number | undefined;
            maxTokens?: number | undefined;
            cache?: boolean | undefined;
        } | undefined;
    }, {
        budget?: {
            maxTokens?: number | undefined;
            maxUsd?: number | undefined;
            maxSteps?: number | undefined;
        } | undefined;
        defaultModel?: {
            provider: string;
            model: string;
            params?: Record<string, unknown> | undefined;
            temperature?: number | undefined;
            maxTokens?: number | undefined;
            cache?: boolean | undefined;
        } | undefined;
    }>>;
    metadata: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    config: {
        budget?: {
            maxTokens?: number | undefined;
            maxUsd?: number | undefined;
            maxSteps?: number | undefined;
        } | undefined;
        defaultModel?: {
            provider: string;
            model: string;
            params?: Record<string, unknown> | undefined;
            temperature?: number | undefined;
            maxTokens?: number | undefined;
            cache?: boolean | undefined;
        } | undefined;
    };
    id: string;
    schemaVersion: 1;
    channels: {
        type: "text" | "image" | "file" | "audio" | "json" | "any";
        name: string;
        reducer: "lastValue" | "append" | "merge";
        initial?: unknown;
        description?: string | undefined;
    }[];
    resources: {
        name: string;
        kind: string;
        scope: "run" | "session";
        config: Record<string, unknown>;
    }[];
    nodes: {
        type: string;
        config: Record<string, unknown>;
        id: string;
        position?: {
            x: number;
            y: number;
        } | undefined;
    }[];
    edges: {
        id: string;
        source: string;
        target: string;
        sourceHandle?: string | undefined;
        targetHandle?: string | undefined;
    }[];
    metadata: Record<string, unknown>;
}, {
    name: string;
    id: string;
    schemaVersion: 1;
    nodes: {
        type: string;
        id: string;
        config?: Record<string, unknown> | undefined;
        position?: {
            x: number;
            y: number;
        } | undefined;
    }[];
    edges: {
        id: string;
        source: string;
        target: string;
        sourceHandle?: string | undefined;
        targetHandle?: string | undefined;
    }[];
    config?: {
        budget?: {
            maxTokens?: number | undefined;
            maxUsd?: number | undefined;
            maxSteps?: number | undefined;
        } | undefined;
        defaultModel?: {
            provider: string;
            model: string;
            params?: Record<string, unknown> | undefined;
            temperature?: number | undefined;
            maxTokens?: number | undefined;
            cache?: boolean | undefined;
        } | undefined;
    } | undefined;
    channels?: {
        name: string;
        type?: "text" | "image" | "file" | "audio" | "json" | "any" | undefined;
        reducer?: "lastValue" | "append" | "merge" | undefined;
        initial?: unknown;
        description?: string | undefined;
    }[] | undefined;
    resources?: {
        name: string;
        kind: string;
        scope?: "run" | "session" | undefined;
        config?: Record<string, unknown> | undefined;
    }[] | undefined;
    metadata?: Record<string, unknown> | undefined;
}>;
export type Flow = z.infer<typeof FlowSchema>;
/** Parse and structurally validate an unknown value into a typed Flow. */
export declare function parseFlow(input: unknown): Flow;
//# sourceMappingURL=flow.d.ts.map