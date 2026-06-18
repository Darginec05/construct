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
    | "usage"
    | "error";
  nodeId?: string;
  data?: unknown;
}

/** Token accounting for one model turn, surfaced via `usage` events. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
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
  /**
   * Per-run model providers, keyed by provider id (e.g. "anthropic"). The engine
   * forwards these to executors via `ExecutorContext.getProvider` WITHOUT knowing
   * what a provider is (it stays model-agnostic — hence `unknown`). When absent,
   * executors fall back to the global `registerProvider` registry, so existing
   * single-tenant hosts are unaffected. A multi-tenant host (the cloud runner)
   * uses this to inject a different tenant's decrypted key per run, avoiding the
   * global registry's cross-run key races.
   */
  providers?: Record<string, unknown>;
  /**
   * Per-run tools, keyed by tool name. Mirrors {@link providers}: the engine
   * forwards these to executors via `ExecutorContext.getTool` WITHOUT knowing
   * what a tool is (it stays tool-agnostic — hence `unknown`). When absent,
   * executors fall back to the global `registerTool` registry, so existing
   * single-tenant hosts are unaffected. A multi-tenant host (the cloud runner)
   * uses this to inject a tenant's own (e.g. custom) tools per run instead of
   * leaking them into the process-global registry shared across tenants.
   */
  tools?: Record<string, unknown>;
  /**
   * Per-run prompt bodies, keyed by the DSL `PromptRef.ref`. Mirrors
   * {@link providers} / {@link tools}: the engine forwards these to executors via
   * `ExecutorContext.getPrompt` WITHOUT knowing where a prompt comes from (it
   * stays registry-agnostic). A host (the cloud runner) resolves each `ref` to
   * its template body before the run and injects the map here; the engine then
   * binds the ref's declared `vars` and interpolates the body against run state.
   * When a `PromptRef`'s `ref` is absent from this map, the agent/router node
   * fails the run.
   */
  prompts?: Record<string, string>;
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
  /**
   * Resume a previously paused run at a top-level human node. The paused node is
   * NOT re-executed: the scheduler instead follows the chosen `handle` out of it,
   * after applying `patch` to the seeded state (e.g. the human's captured reply).
   * Pair with `initialState` carrying the paused channel snapshot.
   *
   * Only top-level human pauses are resumable. A nested pause (its `nodeId`
   * contains "/") cannot be resumed this way because the scheduler frontier inside
   * the loop / map / subflow was not preserved when it bubbled up.
   */
  resume?: { nodeId: string; handle: string; patch?: Record<string, unknown> };
  /** Global guard against runaway cycles. Default 1000. */
  maxSteps?: number;
  /** Run assertValidFlow before executing. Default true. */
  validate?: boolean;
  /**
   * Cooperative cancellation. The worklist checks this between nodes and stops
   * with a failed result when it is aborted; nested loop/map/subflow runs inherit
   * it through the same options. It does NOT interrupt a node already in flight
   * (e.g. an open model stream) — that needs provider-level abort. A host (the
   * cloud runner) passes the HTTP request signal so a client disconnect stops
   * scheduling further work instead of running the flow to completion.
   */
  signal?: AbortSignal;
}

/**
 * Describes a human node the run is waiting on. `nodeId` is prefixed with each
 * enclosing node's id for a nested pause (e.g. "map1/review"); `exits` are the
 * handles the human may follow. `mode`, `prompt`, and `writeTo` mirror the human
 * node's config so a host can render the prompt and route the captured reply.
 */
export interface PausePoint {
  nodeId: string;
  exits: string[];
  mode?: string;
  prompt?: string;
  writeTo?: string;
}

export interface RunResult {
  flowId: string;
  status: RunStatus;
  state: RunState;
  /** Value produced by the (last) output node. */
  output?: unknown;
  /** Set when status is "paused". */
  pause?: PausePoint;
  error?: string;
}

/** What a node implementation receives. */
export interface ExecutorContext {
  config: Record<string, unknown>;
  state: RunState;
  /**
   * Evaluate a DSL expression (or bundle) against the current state. `scope`
   * adds extra bindings layered on top of state (they shadow same-named
   * channels) — used to resolve a prompt ref's declared `vars` inside its body.
   */
  evaluate(expr: unknown, scope?: Record<string, unknown>): unknown;
  /** Emit a streamed text chunk as a `token` event for the current node. */
  onDelta(text: string): void;
  /** Report token usage for one model turn as a `usage` event. */
  onUsage?: (usage: TokenUsage) => void;
  /**
   * Resolve a per-run model provider by id, set from `RunOptions.providers`.
   * Returns `unknown` because the engine is model-agnostic; provider-aware
   * executors (@construct/nodes) narrow it and fall back to the global registry
   * when this is absent or returns undefined.
   */
  getProvider?: (id: string) => unknown;
  /**
   * Resolve a per-run tool by name, set from `RunOptions.tools`. Returns
   * `unknown` because the engine is tool-agnostic; tool-aware executors
   * (@construct/nodes) narrow it and fall back to the global registry when this
   * is absent or returns undefined.
   */
  getTool?: (name: string) => unknown;
  /**
   * Resolve a registry prompt body by `ref`, set from `RunOptions.prompts`.
   * Returns the raw template (with `{{var}}` placeholders) or `undefined` when
   * unknown; prompt-aware executors (@construct/nodes) bind the ref's `vars` and
   * interpolate it. Absent when the host injected no prompts.
   */
  getPrompt?: (ref: string) => string | undefined;
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
  /** Chosen output handle (router/human). Defaults to "out". */
  handle?: string;
}

export type NodeExecutor = (
  ctx: ExecutorContext,
) => ExecutorResult | Promise<ExecutorResult>;

/** A named deterministic function backing a `code` node's `ref`. */
export type RunFunction = (ctx: ExecutorContext) => unknown | Promise<unknown>;
