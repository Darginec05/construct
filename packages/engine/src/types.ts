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
    | "token"
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

/**
 * A request to approve a gated tool call before it runs. Raised by leaf
 * executors (e.g. the agent loop) for tools whose tier requires human approval.
 * `tier` is the tool's declared safety class, left as a string so the engine
 * does not depend on the tools package.
 */
export interface ToolApprovalRequest {
  /** Node that wants to run the tool. */
  nodeId: string;
  /** Registered name of the tool. */
  tool: string;
  /** The tool's declared tier, if any. */
  tier?: string;
  /** Arguments the model proposed for the call. */
  args: unknown;
}

export interface ToolApprovalDecision {
  approved: boolean;
  /** Optional rationale, surfaced back to the model on rejection. */
  reason?: string;
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
  /**
   * Approves (or rejects) a gated tool call. When absent, executors must fail
   * safe and treat gated calls as rejected.
   *
   * Unlike a `human` node, this resolves *inline* — it holds the run open while
   * awaiting the decision. It suits programmatic policy (allow-lists, auto-deny)
   * or a short-lived interactive session, NOT durable human approval that may
   * take hours; durable pause/resume of an agent mid-loop is not yet supported.
   */
  onToolApproval?: (
    req: ToolApprovalRequest,
  ) => ToolApprovalDecision | Promise<ToolApprovalDecision>;
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
  /** Emit a streamed text chunk as a `token` event for the current node. */
  onDelta(text: string): void;
  /**
   * Request human approval for a gated tool call. The engine injects the
   * current node id. Absent when the host configured no approver — callers must
   * then fail safe (treat the call as rejected).
   */
  requestApproval?: (
    req: Omit<ToolApprovalRequest, "nodeId">,
  ) => Promise<ToolApprovalDecision>;
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
