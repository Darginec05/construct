import type {
  Channel,
  DataType,
  FlowEdge,
  FlowNode,
  ModelRef,
  Resource,
  Budget,
} from "@construct/dsl";
import { toJsonSchema, type Tool } from "@construct/tools";
import type { ZodType } from "zod";
import {
  ChannelHandle,
  ResourceHandle,
  tpl,
  toChannel,
  toExpr,
  toResource,
  type ChannelInit,
  type ExprInput,
} from "./expr.js";
import { isFlowRef, isNodeDef, type FlowRef, type NodeDef } from "./types.js";

/** Mutable graph accumulated while a flow's builder callback runs. */
interface GraphState {
  nodes: FlowNode[];
  edges: FlowEdge[];
  channels: Channel[];
  resources: Resource[];
  counters: Map<string, number>;
  usedIds: Set<string>;
  edgeSeq: number;
  /** Tools referenced by `agent`/`tool` nodes — registered before a run. */
  tools: Map<string, Tool>;
  /** `code` handlers (from defineNode) keyed by ref id — registered before a run. */
  functions: Map<string, NodeDef>;
  /** Flows used as subflow/loop/map bodies — bundled into the run's flow map. */
  subflows: Set<FlowRef>;
}

// --- friendly option shapes -------------------------------------------------

interface NodeId {
  /** Override the auto-generated node id (defaults to `<type>`, `<type>2`, …). */
  id?: string;
  /** Editor-only display name an author gives the node; ignored by the engine. */
  label?: string;
  /** Editor-only note describing the node's role; ignored by the engine. */
  description?: string;
}

type Body = FlowRef | string;
type Output =
  | "text"
  | ZodType
  | { schema: Record<string, unknown> }
  | Record<string, unknown>;

export interface AgentOpts extends NodeId {
  model: ModelRef;
  system?: string;
  prompt?: ExprInput;
  /** Prior conversation turns for a multi-turn session: a channel holding a list
   *  of `{ role: "user" | "assistant", content: string }`, replayed before the
   *  current prompt. The host windows/persists it; the engine only reads it. */
  history?: ExprInput;
  tools?: Tool[];
  toolChoice?: "auto" | "required" | "none";
  maxSteps?: number;
  output?: Output;
  budget?: Budget;
  writeTo?: ChannelHandle | string;
}

export interface RouterClassInput {
  name: string;
  description?: string;
}

export interface RouterOpts extends NodeId {
  model: ModelRef;
  prompt?: ExprInput;
  classes: RouterClassInput[];
  /** Add a built-in "fallback" handle for low-confidence / no-match inputs. */
  fallback?: boolean;
  writeTo?: ChannelHandle | string;
  /** Store the model's one-line rationale for the pick. */
  reasonTo?: ChannelHandle | string;
  /** Store a clarifying question produced when routing to "fallback". Requires `fallback`. */
  clarifyTo?: ChannelHandle | string;
}

export interface BranchOpts extends NodeId {
  condition: ExprInput;
}

export interface SwitchOpts extends NodeId {
  on: ExprInput;
  cases: string[];
}

export interface LoopOpts extends NodeId {
  body: Body;
  until?: ExprInput;
  maxIterations?: number;
  budget?: Budget;
  writeTo?: ChannelHandle | string;
}

export interface MapOpts extends NodeId {
  over: ExprInput;
  body: Body;
  concurrency?: number;
  aggregate?: "merge" | "collect";
  onError?: "fail" | "skip" | "collect";
  writeTo?: ChannelHandle | string;
}

export interface JoinOpts extends NodeId {
  mode?: "all" | "any" | "quorum";
  count?: number;
  writeTo?: ChannelHandle | string;
}

export interface CodeOpts extends NodeId {
  inline?: string;
  writeTo?: ChannelHandle | string;
}

export interface RetrieveOpts extends NodeId {
  store: string;
  query: ExprInput;
  topK?: number;
  writeTo?: ChannelHandle | string;
}

export interface TransformOpts extends NodeId {
  expr: ExprInput;
  writeTo?: ChannelHandle | string;
}

export interface ToolOpts extends NodeId {
  args?: Record<string, ExprInput>;
  tier?: Tool["tier"];
  requiresApproval?: boolean;
  resource?: ResourceHandle | string;
  writeTo?: ChannelHandle | string;
}

export interface HumanOpts extends NodeId {
  mode: "approve" | "select" | "annotate" | "collect";
  prompt?: string;
  exits?: string[];
  ttl?: number;
  writeTo?: ChannelHandle | string;
}

export interface SubflowOpts extends NodeId {
  inputs?: Record<string, ExprInput>;
  writeTo?: ChannelHandle | string;
}

// --- config mapping ---------------------------------------------------------

/**
 * Detect a Zod schema structurally rather than with `instanceof`: a consumer's
 * schema comes from *their* copy of zod, which may not be the copy bundled here.
 * Every zod 3 schema carries a `_def` and a `parse` method — mirrors the same
 * structural check `@construct/tools` uses for exactly this reason.
 */
function isZodSchema(value: unknown): value is ZodType {
  return (
    typeof value === "object" &&
    value !== null &&
    "_def" in value &&
    typeof (value as { parse?: unknown }).parse === "function"
  );
}

function resolveOutput(output: Output | undefined): unknown {
  if (output === undefined) return undefined;
  if (output === "text") return "text";
  if (isZodSchema(output)) return { schema: toJsonSchema(output) };
  if (typeof output === "object" && "schema" in output) return output;
  return { schema: output };
}

function mapArgs(
  args: Record<string, ExprInput> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(args ?? {})) out[k] = toExpr(v);
  return out;
}

/** Drop undefined keys so emitted config matches a hand-written document. */
function clean<T extends Record<string, unknown>>(obj: T): T {
  for (const k of Object.keys(obj)) {
    if (obj[k] === undefined) delete obj[k];
  }
  return obj;
}

/**
 * A connection origin: either a node (default "out" handle) or a node's named
 * output handle (via {@link NodeHandle.on}). Both can create a downstream node
 * — wiring the edge automatically — or point at an existing node with `.to`.
 */
abstract class Connector {
  constructor(protected readonly b: FlowBuilder) {}

  /** The edge origin this connector wires from. */
  protected abstract origin(): { id: string; handle?: string };

  /** Connect to an already-created node, returning it for further chaining. */
  to(target: NodeHandle): NodeHandle {
    const o = this.origin();
    this.b.connect(o.id, target.id, o.handle);
    return target;
  }

  agent(opts: AgentOpts): NodeHandle {
    for (const t of opts.tools ?? []) this.b.useTool(t);
    return this.b.spawn(this.origin(), "agent", opts, clean({
      model: opts.model,
      system: opts.system,
      prompt: opts.prompt === undefined ? undefined : toExpr(opts.prompt),
      history: opts.history === undefined ? undefined : toExpr(opts.history),
      tools: opts.tools?.map((t) => t.name),
      toolChoice: opts.toolChoice,
      maxSteps: opts.maxSteps,
      output: resolveOutput(opts.output),
      budget: opts.budget,
      writeTo: toChannel(opts.writeTo),
    }));
  }

  router(opts: RouterOpts): NodeHandle {
    return this.b.spawn(this.origin(), "router", opts, clean({
      model: opts.model,
      prompt: opts.prompt === undefined ? undefined : toExpr(opts.prompt),
      classes: opts.classes,
      fallback: opts.fallback,
      writeTo: toChannel(opts.writeTo),
      reasonTo: toChannel(opts.reasonTo),
      clarifyTo: toChannel(opts.clarifyTo),
    }));
  }

  branch(opts: BranchOpts): NodeHandle {
    return this.b.spawn(this.origin(), "branch", opts, {
      condition: toExpr(opts.condition),
    });
  }

  switch(opts: SwitchOpts): NodeHandle {
    return this.b.spawn(this.origin(), "switch", opts, {
      on: toExpr(opts.on),
      cases: opts.cases,
    });
  }

  loop(opts: LoopOpts): NodeHandle {
    return this.b.spawn(this.origin(), "loop", opts, clean({
      body: this.b.useBody(opts.body),
      until: opts.until === undefined ? undefined : toExpr(opts.until),
      maxIterations: opts.maxIterations,
      budget: opts.budget,
      writeTo: toChannel(opts.writeTo),
    }));
  }

  map(opts: MapOpts): NodeHandle {
    return this.b.spawn(this.origin(), "map", opts, clean({
      over: toExpr(opts.over),
      body: this.b.useBody(opts.body),
      concurrency: opts.concurrency,
      aggregate: opts.aggregate,
      onError: opts.onError,
      writeTo: toChannel(opts.writeTo),
    }));
  }

  code(ref: string | NodeDef, opts: CodeOpts = {}): NodeHandle {
    const refId = isNodeDef(ref) ? this.b.useFunction(ref) : ref;
    return this.b.spawn(this.origin(), "code", opts, clean({
      ref: opts.inline ? undefined : refId,
      inline: opts.inline,
      writeTo: toChannel(opts.writeTo),
    }));
  }

  retrieve(opts: RetrieveOpts): NodeHandle {
    return this.b.spawn(this.origin(), "retrieve", opts, clean({
      store: opts.store,
      query: toExpr(opts.query),
      topK: opts.topK,
      writeTo: toChannel(opts.writeTo),
    }));
  }

  transform(opts: TransformOpts): NodeHandle {
    return this.b.spawn(this.origin(), "transform", opts, clean({
      expr: toExpr(opts.expr),
      writeTo: toChannel(opts.writeTo),
    }));
  }

  tool(impl: Tool, opts: ToolOpts = {}): NodeHandle {
    this.b.useTool(impl);
    return this.b.spawn(this.origin(), "tool", opts, clean({
      tool: impl.name,
      args: mapArgs(opts.args),
      tier: opts.tier ?? impl.tier,
      requiresApproval: opts.requiresApproval ?? impl.requiresApproval,
      resource: toResource(opts.resource),
      writeTo: toChannel(opts.writeTo),
    }));
  }

  human(opts: HumanOpts): NodeHandle {
    return this.b.spawn(this.origin(), "human", opts, clean({
      mode: opts.mode,
      prompt: opts.prompt,
      exits: opts.exits,
      ttl: opts.ttl,
      writeTo: toChannel(opts.writeTo),
    }));
  }

  subflow(body: Body, opts: SubflowOpts = {}): NodeHandle {
    return this.b.spawn(this.origin(), "subflow", opts, clean({
      flow: this.b.useBody(body),
      inputs: opts.inputs ? mapArgs(opts.inputs) : undefined,
      writeTo: toChannel(opts.writeTo),
    }));
  }
}

/** A node in the graph; the unit you chain from and connect to. */
export class NodeHandle extends Connector {
  constructor(
    b: FlowBuilder,
    readonly id: string,
    readonly type: string,
  ) {
    super(b);
  }

  protected origin(): { id: string; handle?: string } {
    return { id: this.id };
  }

  /** Leave this node through a named output handle (branch/router/human). */
  on(handle: string): PendingEdge {
    return new PendingEdge(this.b, this.id, handle);
  }
}

/** A dangling edge from a node's named handle, awaiting a target. */
export class PendingEdge extends Connector {
  constructor(
    b: FlowBuilder,
    private readonly sourceId: string,
    private readonly handle: string,
  ) {
    super(b);
  }

  protected origin(): { id: string; handle?: string } {
    return { id: this.sourceId, handle: this.handle };
  }
}

// --- the builder facade -----------------------------------------------------

export interface InputOpts extends NodeId {
  /** Declare the entry contract from one channel… */
  channel?: ChannelHandle;
  /** …or several, as a map of field name -> channel handle. */
  schema?: Record<string, ChannelHandle>;
}

type OutputFrom = ChannelHandle | ExprInput | Record<string, ExprInput>;

/**
 * Passed to a {@link defineFlow} callback. Declares channels and resources,
 * places the input/output nodes, and seeds the graph. Node-creation methods
 * live on the returned {@link NodeHandle}s; this object owns flow-level state.
 */
export class FlowBuilder {
  private readonly s: GraphState = {
    nodes: [],
    edges: [],
    channels: [],
    resources: [],
    counters: new Map(),
    usedIds: new Set(),
    edgeSeq: 0,
    tools: new Map(),
    functions: new Map(),
    subflows: new Set(),
  };

  /** Build a prompt template; channel handles become `{{name}}` tokens. */
  readonly tpl = tpl;

  private channel<T>(
    name: string,
    type: DataType,
    init: ChannelInit = {},
  ): ChannelHandle<T> {
    const reducer = init.reducer ?? "lastValue";
    this.s.channels.push(
      clean({
        name,
        type,
        reducer,
        initial: init.initial,
        description: init.description,
      }) as Channel,
    );
    return new ChannelHandle<T>(name, type, reducer);
  }

  text(name: string, init?: ChannelInit): ChannelHandle<string> {
    return this.channel<string>(name, "text", init);
  }

  /** A json channel. Pass a Zod schema to type the handle's value (compile-time). */
  json<T = unknown>(
    name: string,
    schema?: ZodType<T> | ChannelInit,
    init?: ChannelInit,
  ): ChannelHandle<T> {
    const opts = isZodSchema(schema) ? init : (schema as ChannelInit | undefined);
    return this.channel<T>(name, "json", opts);
  }

  image(name: string, init?: ChannelInit): ChannelHandle {
    return this.channel(name, "image", init);
  }

  file(name: string, init?: ChannelInit): ChannelHandle {
    return this.channel(name, "file", init);
  }

  audio(name: string, init?: ChannelInit): ChannelHandle {
    return this.channel(name, "audio", init);
  }

  any<T = unknown>(name: string, init?: ChannelInit): ChannelHandle<T> {
    return this.channel<T>(name, "any", init);
  }

  resource(
    name: string,
    kind: string,
    opts: { scope?: "run" | "session"; config?: Record<string, unknown> } = {},
  ): ResourceHandle {
    const scope = opts.scope ?? "run";
    this.s.resources.push({ name, kind, scope, config: opts.config ?? {} });
    return new ResourceHandle(name, kind, scope);
  }

  /** Place the entry node; returns its handle to start a chain. */
  input(opts: InputOpts = {}): NodeHandle {
    const schema: Record<string, DataType> = {};
    if (opts.channel) schema[opts.channel.name] = opts.channel.type;
    for (const [field, ch] of Object.entries(opts.schema ?? {})) {
      schema[field] = ch.type;
    }
    return this.add("input", { schema }, opts);
  }

  /** Place a terminal node surfacing `from` as the run result. */
  output(from: OutputFrom, opts: NodeId = {}): NodeHandle {
    const value =
      from instanceof ChannelHandle || typeof from !== "object"
        ? toExpr(from as ExprInput)
        : mapArgs(from as Record<string, ExprInput>);
    return this.add("output", { from: value }, opts);
  }

  /**
   * AND/quorum barrier: wait for several upstream origins before continuing.
   * Each source may be a node (its default handle) or a named handle via
   * `node.on("handle")`, so a barrier can gather specific branch/router arms.
   */
  join(sources: Array<NodeHandle | PendingEdge>, opts: JoinOpts = {}): NodeHandle {
    const node = this.add(
      "join",
      clean({ mode: opts.mode, count: opts.count, writeTo: toChannel(opts.writeTo) }),
      opts,
    );
    for (const src of sources) src.to(node);
    return node;
  }

  // --- internals used by Connector ---

  /** Allocate a unique node id for a type (`agent`, `agent2`, …). */
  private nextId(type: string): string {
    const n = (this.s.counters.get(type) ?? 0) + 1;
    this.s.counters.set(type, n);
    return n === 1 ? type : `${type}${n}`;
  }

  private add(type: string, config: Record<string, unknown>, opts: NodeId = {}): NodeHandle {
    let nodeId = opts.id ?? this.nextId(type);
    if (this.s.usedIds.has(nodeId)) {
      if (opts.id !== undefined) {
        throw new Error(`builder: duplicate node id "${nodeId}"`);
      }
      // An auto id collided with an explicit one; advance until a free slot.
      do {
        nodeId = this.nextId(type);
      } while (this.s.usedIds.has(nodeId));
    }
    this.s.usedIds.add(nodeId);
    this.s.nodes.push(
      clean({ id: nodeId, type, config, label: opts.label, description: opts.description }) as FlowNode,
    );
    return new NodeHandle(this, nodeId, type);
  }

  /** Create a node and wire an edge from an origin in one step. */
  spawn(
    origin: { id: string; handle?: string },
    type: string,
    opts: NodeId,
    config: Record<string, unknown>,
  ): NodeHandle {
    const node = this.add(type, config, opts);
    this.connect(origin.id, node.id, origin.handle);
    return node;
  }

  connect(source: string, target: string, sourceHandle?: string): void {
    this.s.edges.push(
      clean({ id: `e${++this.s.edgeSeq}`, source, target, sourceHandle }) as FlowEdge,
    );
  }

  useTool(tool: Tool): void {
    this.s.tools.set(tool.name, tool);
  }

  useFunction(def: NodeDef): string {
    this.s.functions.set(def.id, def);
    return def.id;
  }

  useBody(body: Body): string {
    if (isFlowRef(body)) {
      this.s.subflows.add(body);
      return body.id;
    }
    return body;
  }

  /** Snapshot the accumulated graph for {@link defineFlow} to assemble a Flow. */
  drain(): {
    nodes: FlowNode[];
    edges: FlowEdge[];
    channels: Channel[];
    resources: Resource[];
    tools: Tool[];
    functions: NodeDef[];
    subflows: FlowRef[];
  } {
    return {
      nodes: this.s.nodes,
      edges: this.s.edges,
      channels: this.s.channels,
      resources: this.s.resources,
      tools: [...this.s.tools.values()],
      functions: [...this.s.functions.values()],
      subflows: [...this.s.subflows],
    };
  }
}
