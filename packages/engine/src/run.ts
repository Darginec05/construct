import {
  assertValidFlow,
  parseFlow,
  resolveNodeOutputs,
  type Flow,
  type FlowEdge,
  type FlowNode,
} from "@construct/dsl";
import { applyPatch, channelMap, initState } from "./channels.js";
import { evaluate, truthy } from "./expr.js";
import { getExecutor } from "./executors.js";
import type {
  ExecutorContext,
  PausePoint,
  RunEvent,
  RunOptions,
  RunResult,
  RunState,
} from "./types.js";

interface StepOutcome {
  patch?: Record<string, unknown>;
  handle?: string;
  output?: unknown;
  /** Set when the node (or a nested flow) pauses for a human. */
  pause?: PausePoint;
}

type Emit = (event: RunEvent) => void;

/**
 * Execute a flow as a worklist over the graph. A node with several incoming
 * edges fires on ANY delivery (OR-join), which is what loop / branch re-entry
 * needs; a `join` node is the explicit AND / quorum barrier. Cycles are bounded
 * by branch conditions plus a global `maxSteps` guard.
 */
export async function runFlow(
  flow: Flow,
  options: RunOptions = {},
): Promise<RunResult> {
  const parsed = parseFlow(flow);
  if (options.validate !== false) assertValidFlow(parsed);

  const channels = channelMap(parsed);
  const state = initState(parsed, options.input, options.initialState);
  const emit: Emit = options.onEvent ?? (() => {});
  const maxSteps = options.maxSteps ?? 1000;

  const nodesById = new Map(parsed.nodes.map((n) => [n.id, n]));
  const outEdges = new Map<string, FlowEdge[]>();
  const inDegree = new Map<string, number>();
  for (const node of parsed.nodes) inDegree.set(node.id, 0);
  for (const edge of parsed.edges) {
    const list = outEdges.get(edge.source);
    if (list) list.push(edge);
    else outEdges.set(edge.source, [edge]);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  // Join bookkeeping: which edges feed each join, and which have delivered.
  const joinExpected = new Map<string, number>();
  const joinArrivals = new Map<string, Set<string>>();
  const joinFired = new Set<string>();
  for (const node of parsed.nodes) {
    if (node.type === "join") {
      joinExpected.set(
        node.id,
        parsed.edges.filter((e) => e.target === node.id).length,
      );
      joinArrivals.set(node.id, new Set());
    }
  }

  const queue: string[] = [];

  emit({ type: "run-start", data: { flowId: parsed.id } });

  // Resume path: don't re-run the paused human node. Apply its captured patch and
  // seed the frontier with the out-edges of `resume.handle`, exactly as if the
  // node had just finished and chosen that handle.
  if (options.resume) {
    const { nodeId, handle, patch } = options.resume;
    if (!nodesById.has(nodeId)) {
      return fail(parsed.id, state, `resume target "${nodeId}" not found`, emit, nodeId);
    }
    if (patch) applyPatch(state, patch, channels);
    for (const edge of outEdges.get(nodeId) ?? []) {
      if (edge.sourceHandle && edge.sourceHandle !== handle) continue;
      enqueue(edge);
    }
  } else {
    // Start at input nodes; fall back to roots (in-degree 0) when there are none.
    const inputs = parsed.nodes.filter((n) => n.type === "input").map((n) => n.id);
    const roots =
      inputs.length > 0
        ? inputs
        : parsed.nodes
            .filter((n) => (inDegree.get(n.id) ?? 0) === 0)
            .map((n) => n.id);
    for (const id of roots) queue.push(id);
  }

  let runOutput: unknown;
  let steps = 0;

  while (queue.length > 0) {
    if (options.signal?.aborted) {
      return fail(parsed.id, state, "run aborted", emit);
    }
    if (++steps > maxSteps) {
      return fail(parsed.id, state, `step limit (${maxSteps}) exceeded`, emit);
    }
    const nodeId = queue.shift() as string;
    const node = nodesById.get(nodeId);
    if (!node) continue;

    emit({ type: "node-start", nodeId, data: node.config });
    const onToolApproval = options.onToolApproval;
    const providers = options.providers;
    const tools = options.tools;
    const prompts = options.prompts;
    const ctx: ExecutorContext = {
      config: node.config,
      state,
      evaluate: (e, scope) => evaluate(e, scope ? { ...state, ...scope } : state),
      onDelta: (text) => emit({ type: "token", nodeId, data: text }),
      onUsage: (usage) => emit({ type: "usage", nodeId, data: usage }),
      getProvider: providers ? (id) => providers[id] : undefined,
      getTool: tools ? (name) => tools[name] : undefined,
      getPrompt: prompts ? (ref) => prompts[ref] : undefined,
      requestApproval: onToolApproval
        ? (req) => Promise.resolve(onToolApproval({ nodeId, ...req }))
        : undefined,
    };

    let outcome: StepOutcome;
    try {
      outcome = await stepNode(node, ctx, state, options);
    } catch (err) {
      return fail(parsed.id, state, String(err), emit, nodeId);
    }

    if (outcome.pause) {
      emit({ type: "paused", nodeId });
      return {
        flowId: parsed.id,
        status: "paused",
        state,
        output: runOutput,
        pause: outcome.pause,
      };
    }

    if (outcome.patch) applyPatch(state, outcome.patch, channels);
    if (outcome.output !== undefined) runOutput = outcome.output;
    // Surface what the node produced for telemetry: an output node's value, else
    // the state patch it wrote (the meaningful "node output" for leaf executors).
    emit({
      type: "node-finish",
      nodeId,
      data: outcome.output !== undefined ? outcome.output : (outcome.patch ?? null),
    });

    const handle = resolveHandle(node, outcome, ctx);
    for (const edge of outEdges.get(nodeId) ?? []) {
      if (edge.sourceHandle && edge.sourceHandle !== handle) continue;
      enqueue(edge);
    }
  }

  // A join that received some but not all of its branches is a stuck barrier;
  // surface it instead of silently completing a partial run.
  for (const [joinId, arrivals] of joinArrivals) {
    if (!joinFired.has(joinId) && arrivals.size > 0) {
      return fail(
        parsed.id,
        state,
        `join "${joinId}" stalled: ${arrivals.size}/${joinExpected.get(joinId)} branches arrived`,
        emit,
        joinId,
      );
    }
  }

  emit({ type: "run-finish", data: { flowId: parsed.id } });
  return { flowId: parsed.id, status: "completed", state, output: runOutput };

  function enqueue(edge: FlowEdge): void {
    const target = edge.target;
    const node = nodesById.get(target);
    if (node?.type === "join") {
      if (joinFired.has(target)) return;
      const arrivals = joinArrivals.get(target) as Set<string>;
      arrivals.add(edge.id);
      const expected = joinExpected.get(target) ?? 1;
      const cfg = node.config as Record<string, unknown>;
      const mode = (cfg.mode as string) ?? "all";
      let threshold =
        mode === "any" ? 1 : mode === "quorum" ? Number(cfg.count) : expected;
      if (!Number.isFinite(threshold)) threshold = expected;
      if (arrivals.size >= threshold) {
        joinFired.add(target);
        queue.push(target);
      }
      return;
    }
    queue.push(target);
  }
}

async function stepNode(
  node: FlowNode,
  ctx: ExecutorContext,
  state: RunState,
  options: RunOptions,
): Promise<StepOutcome> {
  switch (node.type) {
    case "input":
      return {};
    case "output":
      return { output: ctx.evaluate(node.config.from) };
    case "branch":
    case "switch":
    case "join":
      return {};
    case "loop":
      return runLoop(node, state, options);
    case "map":
      return runMap(node, ctx, state, options);
    case "subflow":
      return runSubflow(node, ctx, options);
    case "human": {
      if (options.onHuman) {
        const decision = await options.onHuman(node, ctx);
        return { patch: decision.patch, handle: decision.handle };
      }
      const cfg = node.config as Record<string, unknown>;
      return {
        pause: {
          nodeId: node.id,
          exits: resolveNodeOutputs(node.type, node.config),
          mode: typeof cfg.mode === "string" ? cfg.mode : undefined,
          prompt: typeof cfg.prompt === "string" ? cfg.prompt : undefined,
          writeTo: typeof cfg.writeTo === "string" ? cfg.writeTo : undefined,
        },
      };
    }
    default: {
      const executor = getExecutor(node.type);
      if (!executor) {
        throw new Error(`no executor registered for node type "${node.type}"`);
      }
      return executor(ctx);
    }
  }
}

function resolveHandle(
  node: FlowNode,
  outcome: StepOutcome,
  ctx: ExecutorContext,
): string {
  if (node.type === "branch") {
    return truthy(ctx.evaluate(node.config.condition)) ? "true" : "false";
  }
  if (node.type === "switch") {
    const on = String(ctx.evaluate(node.config.on));
    const cases = (node.config.cases as string[]) ?? [];
    return cases.includes(on) ? on : "default";
  }
  return outcome.handle ?? "out";
}

function resolveBody(id: unknown, options: RunOptions): Flow {
  const flow = typeof id === "string" ? options.flows?.[id] : undefined;
  if (!flow) throw new Error(`unresolved sub-flow "${String(id)}"`);
  return flow;
}

/** Bubble a nested flow's pause up, prefixing the node id with this node's. */
function bubble(node: FlowNode, child: RunResult): StepOutcome {
  return {
    pause: {
      nodeId: `${node.id}/${child.pause?.nodeId ?? "?"}`,
      exits: child.pause?.exits ?? [],
      mode: child.pause?.mode,
      prompt: child.pause?.prompt,
      writeTo: child.pause?.writeTo,
    },
  };
}

async function runLoop(
  node: FlowNode,
  state: RunState,
  options: RunOptions,
): Promise<StepOutcome> {
  const body = resolveBody(node.config.body, options);
  const max = Number(node.config.maxIterations ?? 5);
  const until = node.config.until;
  const writeTo = node.config.writeTo;

  let last: RunResult | undefined;
  for (let i = 0; i < max; i++) {
    const res = await runFlow(body, { ...options, input: { ...state } });
    if (res.status === "paused") return bubble(node, res);
    if (res.status === "failed") {
      throw new Error(`loop body failed: ${res.error}`);
    }
    // The body's resulting state replaces the working channels for the next
    // iteration (a snapshot, not a reducer merge — it already holds the merge).
    Object.assign(state, res.state);
    last = res;
    if (until && truthy(evaluate(until, state))) break;
  }

  if (typeof writeTo === "string" && last) {
    return { patch: { [writeTo]: last.output ?? last.state } };
  }
  return {};
}

async function runMap(
  node: FlowNode,
  ctx: ExecutorContext,
  state: RunState,
  options: RunOptions,
): Promise<StepOutcome> {
  const body = resolveBody(node.config.body, options);
  const items = ctx.evaluate(node.config.over);
  const list = Array.isArray(items) ? items : [];
  const concurrency = Math.max(1, Number(node.config.concurrency ?? 4));
  const aggregate = (node.config.aggregate as string) ?? "collect";

  const collected: unknown[] = [];
  const merged: Record<string, unknown> = {};

  for (let i = 0; i < list.length; i += concurrency) {
    const chunk = list.slice(i, i + concurrency);
    const settled = await Promise.all(
      chunk.map(async (item, j) => {
        const seed: RunState = { item, index: i + j, ...state };
        const res = await runFlow(body, { ...options, input: seed });
        return { res, seed };
      }),
    );
    for (const { res, seed } of settled) {
      if (res.status === "paused") return bubble(node, res);
      if (res.status === "failed") {
        throw new Error(`map body failed: ${res.error}`);
      }
      if (aggregate === "merge") {
        Object.assign(merged, diffState(seed, res.state));
      } else {
        collected.push(res.output !== undefined ? res.output : diffState(seed, res.state));
      }
    }
  }

  const value = aggregate === "merge" ? merged : collected;
  const writeTo = node.config.writeTo;
  return typeof writeTo === "string" ? { patch: { [writeTo]: value } } : {};
}

async function runSubflow(
  node: FlowNode,
  ctx: ExecutorContext,
  options: RunOptions,
): Promise<StepOutcome> {
  const body = resolveBody(node.config.flow, options);
  const input = ctx.evaluate(node.config.inputs ?? {}) as RunState;
  const res = await runFlow(body, { ...options, input });
  if (res.status === "paused") return bubble(node, res);
  if (res.status === "failed") {
    throw new Error(`subflow failed: ${res.error}`);
  }
  const value = res.output !== undefined ? res.output : res.state;
  const writeTo = node.config.writeTo;
  return typeof writeTo === "string" ? { patch: { [writeTo]: value } } : {};
}

/** Channels the child actually wrote (reference changed vs the seed). */
function diffState(seed: RunState, result: RunState): Record<string, unknown> {
  const delta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(result)) {
    if (seed[key] !== value) delta[key] = value;
  }
  return delta;
}

function fail(
  flowId: string,
  state: RunState,
  error: string,
  emit: Emit,
  nodeId?: string,
): RunResult {
  emit({ type: "error", nodeId, data: error });
  return { flowId, status: "failed", state, error };
}
