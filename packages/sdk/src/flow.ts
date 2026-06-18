import {
  SCHEMA_VERSION,
  assertValidFlow,
  validateFlow,
  type Channel,
  type Flow,
  type FlowEdge,
  type FlowNode,
  type Resource,
  type ValidationIssue,
} from "@construct/dsl";
import type {
  ExecutorContext,
  RunFunction,
  RunOptions,
  RunResult,
} from "@construct/engine";
import type { Tool } from "@construct/tools";
import type { ZodType } from "zod";
import { FlowBuilder, type NodeHandle } from "./builder.js";
import { type FlowRef, type NodeDef } from "./types.js";

interface FlowAssets {
  nodes: FlowNode[];
  edges: FlowEdge[];
  channels: Channel[];
  resources: Resource[];
  tools: Tool[];
  functions: NodeDef[];
  subflows: FlowRef[];
}

/** Options forwarded to the engine; `input` and `flows` are supplied by `run`. */
export type RunOpts = Omit<RunOptions, "input" | "flows">;

/** A flow document paired with the id of the flow that references it (`null` for an entry flow). */
export type CollectedFlow = {
  flow: Flow;
  parent: string | null;
};

/**
 * A built flow. `toJSON()` produces the canonical {@link Flow} document — the
 * same shape the visual editor stores, so a builder-authored flow round-trips to
 * the canvas. `run()` executes it locally, lazily wiring the engine + node
 * executors and bundling every referenced tool, code handler, and subflow.
 */
export class FlowDefinition implements FlowRef {
  readonly __kind = "flow" as const;

  constructor(
    readonly id: string,
    readonly name: string,
    private readonly assets: FlowAssets,
  ) {}

  /**
   * Serialize to the canonical {@link Flow} document. Returns a fresh copy each
   * call (arrays and node/resource `config` are cloned), so mutating the result
   * never leaks back into this definition or a later `toJSON()`.
   */
  toJSON(): Flow {
    return {
      schemaVersion: SCHEMA_VERSION,
      id: this.id,
      name: this.name,
      channels: this.assets.channels.map((c) => ({ ...c })),
      resources: this.assets.resources.map((r) => ({ ...r, config: { ...r.config } })),
      nodes: this.assets.nodes.map((n) => ({ ...n, config: { ...n.config } })),
      edges: this.assets.edges.map((e) => ({ ...e })),
      config: {},
      metadata: {},
    };
  }

  /** Semantic issues (catalog config, edges, references) without throwing. */
  validate(): ValidationIssue[] {
    return validateFlow(this.toJSON());
  }

  /** Throw if the flow has any error-level issues; returns `this` for chaining. */
  assertValid(): this {
    assertValidFlow(this.toJSON());
    return this;
  }

  /**
   * Flatten this flow plus every transitively referenced subflow into documents,
   * each paired with the id of the flow that references it (`null` for this entry
   * flow). Entry comes first; each subflow appears once, under its first-seen
   * parent. Lets callers persist a builder's whole flow tree with parent links.
   */
  collect(): CollectedFlow[] {
    const out: CollectedFlow[] = [];
    const seen = new Set<string>();

    const visit = (def: FlowRef, parent: string | null): void => {
      if (seen.has(def.id)) return;
      seen.add(def.id);
      out.push({ flow: def.toJSON(), parent });
      if (def instanceof FlowDefinition) {
        for (const sub of def.assets.subflows) visit(sub, def.id);
      }
    };
    visit(this, null);

    return out;
  }

  /** Collect this flow plus every (transitively) referenced subflow and its assets. */
  private bundle(): {
    flows: Record<string, Flow>;
    tools: Tool[];
    functions: NodeDef[];
  } {
    const flows: Record<string, Flow> = {};
    const tools = new Map<string, Tool>();
    const functions = new Map<string, NodeDef>();

    const visit = (def: FlowRef): void => {
      if (flows[def.id]) return;
      flows[def.id] = def.toJSON();
      if (def instanceof FlowDefinition) {
        for (const t of def.assets.tools) tools.set(t.name, t);
        for (const f of def.assets.functions) functions.set(f.id, f);
        for (const sub of def.assets.subflows) visit(sub);
      }
    };
    visit(this);

    return { flows, tools: [...tools.values()], functions: [...functions.values()] };
  }

  /**
   * Execute the flow locally and resolve with the run result. Registers the
   * flow's tools and `code` handlers, imports `@construct/nodes` for its model/
   * tool executors, and passes referenced subflows to the engine. Model calls
   * need the relevant provider registered (real or fake) before calling.
   *
   * Note: tool and code registration is global (the engine's shared registries),
   * so two flows that define different implementations under the same name will
   * shadow each other across runs. Keep names unique, or run them in separate
   * processes when isolation matters.
   */
  async run(input: Record<string, unknown> = {}, opts: RunOpts = {}): Promise<RunResult> {
    const [engine, , tools] = await Promise.all([
      import("@construct/engine"),
      import("@construct/nodes"), // side-effect: registers built-in leaf executors
      import("@construct/tools"),
    ]);

    const { flows, tools: toolList, functions } = this.bundle();
    for (const t of toolList) tools.registerTool(t);
    for (const fn of functions) engine.registerFunction(fn.id, fn.run);

    return engine.runFlow(this.toJSON(), { input, flows, ...opts });
  }
}

/**
 * Author a flow with the fluent builder. The callback receives a
 * {@link FlowBuilder} (`f`) to declare channels/resources and place nodes; the
 * returned {@link FlowDefinition} can be serialized (`toJSON`) or run (`run`).
 *
 * @example
 * const echo = defineFlow("echo", "Echo", (f) => {
 *   const msg = f.text("message");
 *   f.input({ channel: msg })
 *     .agent({ model: anthropic("claude-haiku-4-5"), prompt: msg, writeTo: msg })
 *     .to(f.output(msg));
 * });
 */
export function defineFlow(
  id: string,
  name: string,
  build: (f: FlowBuilder) => NodeHandle | void,
): FlowDefinition {
  const f = new FlowBuilder();
  build(f);
  return new FlowDefinition(id, name, f.drain());
}

export interface NodeSpec<I = unknown, O = unknown> {
  id: string;
  /** Optional Zod schema; when set, run state is parsed into `run`'s `input`. */
  input?: ZodType<I>;
  /** Optional Zod schema; when set, the return value is parsed before writing. */
  output?: ZodType<O>;
  /** The handler: receives the (optionally validated) state and the raw context. */
  run: (input: I, ctx: ExecutorContext) => O | Promise<O>;
}

/**
 * Author a deterministic `code` handler as a value, then drop it into a flow via
 * `.code(myNode)`. The `id` is the registered ref. `run` receives the current run
 * state as `input` (validated through `input` when provided) plus the raw
 * executor context, and returns the value written to the node's `writeTo`.
 */
export function defineNode<I = unknown, O = unknown>(spec: NodeSpec<I, O>): NodeDef {
  const run: RunFunction = async (ctx: ExecutorContext) => {
    const raw = spec.input ? spec.input.parse(ctx.state) : (ctx.state as I);
    const out = await spec.run(raw, ctx);
    return spec.output ? spec.output.parse(out) : out;
  };
  return { __kind: "node-def", id: spec.id, run };
}
