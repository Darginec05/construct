import { z } from "zod";
import {
  BudgetSchema,
  ChannelSchema,
  ModelRefSchema,
  PositionSchema,
  ResourceSchema,
} from "./primitives.js";

/**
 * The flow DSL is the contract between the OSS engine, the editor, and the
 * (cloud) copilot. Keep it stable, versioned, and well-documented.
 *
 * Structurally the graph is open: a node `type` is any string, and `config`
 * is an opaque record. Built-in types are validated against the node catalog
 * by `validateFlow` (see ./validate); plugins register their own specs.
 */
export const SCHEMA_VERSION = 1 as const;

export const NodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  config: z.record(z.unknown()).default({}),
  /** Editor-only; ignored by the engine. */
  position: PositionSchema.optional(),
});
export type FlowNode = z.infer<typeof NodeSchema>;

export const EdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  /** Which output handle of the source this edge leaves from (branching). */
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
});
export type FlowEdge = z.infer<typeof EdgeSchema>;

export const FlowConfigSchema = z.object({
  defaultModel: ModelRefSchema.optional(),
  budget: BudgetSchema.optional(),
});
export type FlowConfig = z.infer<typeof FlowConfigSchema>;

export const FlowSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  /** Typed shared state with reducers. */
  channels: z.array(ChannelSchema).default([]),
  /** External stateful dependencies (sandbox, Figma, db). */
  resources: z.array(ResourceSchema).default([]),
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
  config: FlowConfigSchema.default({}),
  metadata: z.record(z.unknown()).default({}),
});
export type Flow = z.infer<typeof FlowSchema>;

/** Parse and structurally validate an unknown value into a typed Flow. */
export function parseFlow(input: unknown): Flow {
  return FlowSchema.parse(input);
}
