import type { Flow, FlowNode } from "@construct/dsl";

/** Mutable run state, keyed by channel name. */
export interface RunState {
  [channel: string]: unknown;
}

export type RunStatus = "completed" | "paused" | "failed";

export interface RunEvent {
  type:
    | "run-start"
    | "node-start"
    | "node-finish"
    | "run-finish"
    | "paused"
    | "error";
  nodeId?: string;
  data?: unknown;
}

/** A human node's pending decision, supplied by the host (or a test). */
export interface HumanDecision {
  /** Which output handle to follow (e.g. "approved"). */
  handle: string;
  /** Optional state patch (e.g. captured free-text feedback). */
  patch?: Record<string, unknown>;
}

export interface RunOptions {
  /** The run input payload; its fields seed channels of the same name. */
  input?: RunState;
  /** Extra initial state merged on top of channel defaults and input. */
  initialState?: RunState;
  /** Flows referenced by subflow / loop / map bodies, keyed by flow id. */
  flows?: Record<string, Flow>;
  onEvent?: (event: RunEvent) => void;
  /** Resolves a human pause inline; when absent, the run pauses. */
  onHuman?: (
    node: FlowNode,
    ctx: ExecutorContext,
  ) => HumanDecision | Promise<HumanDecision>;
  /** Global guard against runaway cycles. Default 1000. */
  maxSteps?: number;
  /** Run assertValidFlow before executing. Default true. */
  validate?: boolean;
}

export interface RunResult {
  flowId: string;
  status: RunStatus;
  state: RunState;
  /** Value produced by the (last) output node. */
  output?: unknown;
  /** Set when status is "paused". */
  pause?: { nodeId: string; exits: string[] };
  error?: string;
}

/** What a node implementation receives. */
export interface ExecutorContext {
  config: Record<string, unknown>;
  state: RunState;
  /** Evaluate a DSL expression (or bundle) against the current state. */
  evaluate(expr: unknown): unknown;
}

/** What a node implementation returns. */
export interface ExecutorResult {
  /** State patch, applied through each channel's reducer. */
  patch?: Record<string, unknown>;
  /** Chosen output handle (classifier/human). Defaults to "out". */
  handle?: string;
}

export type NodeExecutor = (
  ctx: ExecutorContext,
) => ExecutorResult | Promise<ExecutorResult>;

/** A named deterministic function backing a `code` node's `ref`. */
export type RunFunction = (ctx: ExecutorContext) => unknown | Promise<unknown>;
