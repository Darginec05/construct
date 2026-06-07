/**
 * construct — the fluent authoring SDK. A thin, typed layer over the
 * @construct/dsl contract: declare channels/resources, place nodes by chaining,
 * and `toJSON()` to the exact `Flow` the visual editor stores (so code and canvas
 * round-trip), or `run()` to execute locally. It adds authoring ergonomics only
 * — the graph stays the orchestration source of truth.
 */
export { defineFlow, defineNode, FlowDefinition } from "./flow.js";
export type { RunOpts, NodeSpec } from "./flow.js";
export { FlowBuilder, NodeHandle, PendingEdge } from "./builder.js";
export type {
  AgentOpts,
  ClassifierOpts,
  BranchOpts,
  SwitchOpts,
  LoopOpts,
  MapOpts,
  JoinOpts,
  CodeOpts,
  RetrieveOpts,
  TransformOpts,
  ToolOpts,
  HumanOpts,
  SubflowOpts,
  InputOpts,
} from "./builder.js";
export { ChannelHandle, ResourceHandle, tpl } from "./expr.js";
export type { ChannelInit, ExprInput } from "./expr.js";
export { anthropic, openai, gemini, provider } from "./model.js";
export type { ModelOptions } from "./model.js";
export type { FlowRef, NodeDef } from "./types.js";

// Re-export tool authoring so a flow and its tools come from one import.
export { defineTool, needsApproval, type Tool } from "@construct/tools";
