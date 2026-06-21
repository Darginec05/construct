import { z } from "zod";
import {
  BudgetSchema,
  ExprSchema,
  type DataType,
  DataTypeSchema,
  ModelRefSchema,
  ToolTierSchema,
} from "./primitives.js";

/**
 * The built-in node catalog. The flow graph itself is open (a node `type` is
 * just a string, so plugins can register their own), but every built-in type
 * ships a typed config schema and a declared set of output handles. The copilot
 * and editor target this catalog; `validateFlow` uses it to check each node's
 * config and the edges leaving it.
 */

export const NodeCategorySchema = z.enum([
  "io", // entry / exit
  "model", // LLM calls and structured decisions
  "control", // branching, loops, fan-out
  "data", // deterministic transforms, retrieval
  "tool", // invoke a registered tool (tiers + approval)
  "human", // human-in-the-loop
  "composite", // nested flows
]);
export type NodeCategory = z.infer<typeof NodeCategorySchema>;

// --- io ---------------------------------------------------------------------

/**
 * One field of the input contract. Accepts the shorthand `"text"` (a bare type)
 * or a full descriptor; the shorthand is normalized to `{ type }` so every
 * consumer sees the object form. `fields` types a structured value recursively,
 * replacing the previously-opaque flat `json`. `default` is only meaningful for
 * optional fields (a value to assume when the caller omits the field).
 */
export type InputField = {
  type: DataType;
  required: boolean;
  description?: string;
  default?: unknown;
  fields?: Record<string, InputField>;
};

const InputFieldSchema: z.ZodType<InputField, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.preprocess(
    (v) => (typeof v === "string" ? { type: v } : v),
    z.object({
      type: DataTypeSchema.default("any"),
      required: z.boolean().default(true),
      description: z.string().min(1).optional(),
      default: z.unknown().optional(),
      fields: z.record(InputFieldSchema).optional(),
    }),
  ),
);

/** Entry point. Declares the (multimodal) input contract: field -> descriptor. */
const InputConfig = z.object({
  schema: z.record(InputFieldSchema).default({}),
});

/** A field that failed the input contract, with a dotted path to its location. */
export interface InputContractError {
  field: string;
  message: string;
}

export interface InputContractResult {
  /** The payload with defaults filled in for missing optional fields. */
  value: Record<string, unknown>;
  errors: InputContractError[];
}

function normalizeInputFields(
  schema: Record<string, InputField>,
  payload: Record<string, unknown>,
  prefix: string,
  errors: InputContractError[],
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...payload };
  for (const [name, field] of Object.entries(schema)) {
    const path = prefix ? `${prefix}.${name}` : name;
    const provided = payload[name];
    if (provided === undefined || provided === null) {
      if (field.default !== undefined) {
        out[name] = field.default;
      } else if (field.required) {
        errors.push({ field: path, message: "is required but was not provided" });
      }
      continue;
    }
    // Present: recurse into a nested object contract so its own defaults are
    // filled and its required fields are checked too.
    if (field.fields && typeof provided === "object" && !Array.isArray(provided)) {
      out[name] = normalizeInputFields(
        field.fields,
        provided as Record<string, unknown>,
        path,
        errors,
      );
    }
  }
  return out;
}

/**
 * Enforce an input node's declared contract against an incoming payload: fill
 * defaults for missing optional fields and report every missing required field.
 * Extra payload keys are preserved (the engine seeds them as state). Pure — it
 * never throws; the caller decides what to do with the collected `errors`.
 *
 * The raw schema is normalized first (string shorthand -> descriptor, field
 * defaults applied), so the engine can pass an input node's unparsed config.
 */
export function applyInputContract(
  schema: Record<string, InputField>,
  payload: Record<string, unknown>,
): InputContractResult {
  const parsed = z.record(InputFieldSchema).safeParse(schema);
  if (!parsed.success) return { value: { ...payload }, errors: [] };
  const errors: InputContractError[] = [];
  const value = normalizeInputFields(parsed.data, payload, "", errors);
  return { value, errors };
}

/**
 * Terminal. Surfaces the run result: either a single value, or a named bundle
 * (e.g. { url, zip, spec, changelog }) when a flow returns several artifacts.
 */
const OutputConfig = z.object({
  from: z.union([ExprSchema, z.record(ExprSchema)]),
});

// --- model ------------------------------------------------------------------

/**
 * A reference to a prompt managed outside the flow (a host-provided registry),
 * resolved to text at runtime. The DSL stays decoupled from any registry: it
 * only carries the `ref` (a stable id/slug).
 *
 * `vars` declares the dynamic values the referenced prompt expects, each bound
 * to a DSL expression evaluated against run state (e.g. `{ context: "$.rag" }`).
 * At runtime the host resolves `ref` to a template body; the engine binds these
 * vars and interpolates the body against `{ ...state, ...vars }`. Declaring vars
 * explicitly keeps the prompt's contract visible in the flow without inlining
 * the prompt text itself.
 */
export const PromptRefSchema = z.object({
  ref: z.string().min(1),
  vars: z.record(ExprSchema).optional(),
});
export type PromptRef = z.infer<typeof PromptRefSchema>;

/**
 * A prompt source: either an inline template expression, or a {@link PromptRef}
 * to a registry-managed prompt. Used for the agent `system`/`prompt` and the
 * router `prompt`.
 */
export const PromptSourceSchema = z.union([ExprSchema, PromptRefSchema]);
export type PromptSource = z.infer<typeof PromptSourceSchema>;

/**
 * The workhorse: a model call that may run a multi-step tool-use loop. With
 * `output: { schema }` it returns structured JSON; with tools + maxSteps it is
 * a full agent loop. `model` is per-node so a flow can mix Haiku and Sonnet.
 *
 * Note: an evaluator / critic is just an `agent` with a structured `output`
 * (e.g. { pass, issues }) feeding a `branch` — no dedicated node needed. The
 * "verifier" can be deterministic instead by using a `code` node in its place.
 */
const AgentConfig = z.object({
  model: ModelRefSchema,
  /**
   * System instructions. A single part (inline template or registry ref) or an
   * ordered array of parts, joined with blank lines — lets a flow layer a shared
   * registry persona with a flow-specific addendum.
   */
  system: z.union([PromptSourceSchema, z.array(PromptSourceSchema)]).optional(),
  prompt: PromptSourceSchema.optional(),
  tools: z.array(z.string()).default([]),
  toolChoice: z.enum(["auto", "required", "none"]).default("auto"),
  /** Cap on tool-use iterations before the loop is force-closed. */
  maxSteps: z.number().int().positive().default(8),
  output: z
    .union([z.literal("text"), z.object({ schema: z.record(z.unknown()) })])
    .default("text"),
  budget: BudgetSchema.optional(),
  writeTo: z.string().optional(),
});

/**
 * A named branch the router can choose. The `description` is what the model
 * actually reads to decide — write it like an instruction to a dispatcher
 * ("billing questions, refunds, charges I don't recognize"), not a bare label.
 */
const RouterClassSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});
export type RouterClass = z.infer<typeof RouterClassSchema>;

/**
 * A cheap, forced-choice decision node (the router pattern). The model reads
 * the input and picks exactly one class; each class `name` becomes an output
 * handle, so downstream edges branch on intent. When `fallback` is on, an extra
 * "fallback" handle catches inputs that match no class — wire it to a default
 * specialist or a clarifying question instead of silently picking the first.
 *
 * `clarifyTo` lets the router double as its own clarifier: when it routes to
 * "fallback" because the input is ambiguous, the model emits a one-line question
 * in the *same* forced call, which is written to that channel. The fallback
 * branch can then surface the question directly — no second model call.
 */
const RouterConfig = z
  .object({
    model: ModelRefSchema,
    prompt: PromptSourceSchema.optional(),
    classes: z.array(RouterClassSchema).min(1),
    /** Add a built-in "fallback" handle for low-confidence / no-match inputs. */
    fallback: z.boolean().optional(),
    writeTo: z.string().optional(),
    /** Optional variable to store the model's one-line rationale for the pick,
     *  so a downstream node can log or branch on *why* it routed. */
    reasonTo: z.string().optional(),
    /** Optional variable to store a clarifying question the model produces when
     *  it routes to "fallback" for an ambiguous input. Requires `fallback`. */
    clarifyTo: z.string().optional(),
  })
  .superRefine((cfg, ctx) => {
    const names = cfg.classes.map((c) => c.name);
    const seen = new Set<string>();
    for (const name of names) {
      const key = name.toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["classes"],
          message: `duplicate route name "${name}"`,
        });
      }
      seen.add(key);
      if (key === "fallback") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["classes"],
          message: `"fallback" is reserved — turn on the fallback option instead of naming a route "fallback"`,
        });
      }
    }
    if (cfg.clarifyTo !== undefined && cfg.fallback !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clarifyTo"],
        message: "clarifyTo requires the fallback option — the question is only produced on the fallback branch",
      });
    }
  });

// --- control ----------------------------------------------------------------

/**
 * Comparison operators for a {@link ConditionRule}. The unary ones
 * (`empty`/`notEmpty`/`truthy`/`falsy`) test the left side alone and ignore
 * `right`; the rest compare `left` against `right`.
 */
export const ComparatorSchema = z.enum([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "notContains",
  "empty",
  "notEmpty",
  "truthy",
  "falsy",
]);
export type Comparator = z.infer<typeof ComparatorSchema>;

/** Comparators that test `left` alone — `right` is omitted in the editor. */
export const UNARY_COMPARATORS = new Set<Comparator>(["empty", "notEmpty", "truthy", "falsy"]);

/**
 * A single comparison. `left` and `right` are expressions (`$.x` / `{{tpl}}` /
 * literal), so either side can read run state or be a constant.
 */
export const ConditionRuleSchema = z.object({
  left: ExprSchema,
  op: ComparatorSchema,
  right: ExprSchema.optional(),
});
export type ConditionRule = z.infer<typeof ConditionRuleSchema>;

/**
 * A structured boolean condition: a flat list of rules joined by one
 * combinator. Replaces the old free-text `condition`, which could only test
 * truthiness of a single value (the expression language has no operators).
 */
export const ConditionSchema = z.object({
  combinator: z.enum(["and", "or"]).default("and"),
  rules: z.array(ConditionRuleSchema).default([]),
});
export type Condition = z.infer<typeof ConditionSchema>;

/** Boolean split. Output handles: "true" / "false". */
const BranchConfig = z.object({
  // A bare expression string is accepted for back-compat and as a raw escape
  // hatch — the engine lifts it into a single `{ left, op: "truthy" }` rule.
  condition: z.union([ConditionSchema, ExprSchema]),
});

/**
 * One arm of a Switch: route to `label` (the output handle) when the subject
 * `on` satisfies `op` against `value`. Reuses the Branch comparators, so the
 * same operator vocabulary drives both nodes. `value` is omitted for unary ops.
 */
export const SwitchCaseSchema = z.object({
  label: z.string().min(1),
  op: ComparatorSchema,
  value: ExprSchema.optional(),
});
export type SwitchCase = z.infer<typeof SwitchCaseSchema>;

/** Multi-way split. Output handles: each case `label` plus "default". */
const SwitchConfig = z.object({
  on: ExprSchema,
  // A bare string case is back-compat sugar for exact equality on that literal
  // (label == value); the engine lifts it into `{ label: s, op: "eq", value: s }`.
  cases: z.array(z.union([SwitchCaseSchema, z.string()])).min(1),
});

/**
 * First-class loop with a hard stop. Runs a sub-flow body repeatedly until
 * `until` is true or `maxIterations` / `budget` is exhausted. This is how the
 * reflection / evaluator-optimizer pattern is expressed.
 */
const LoopConfig = z.object({
  /** id of the sub-flow that forms the loop body. */
  body: z.string(),
  until: ExprSchema.optional(),
  maxIterations: z.number().int().positive().default(5),
  budget: BudgetSchema.optional(),
  writeTo: z.string().optional(),
});

/**
 * Fan-out over a collection. `aggregate: "merge"` combines partial results of
 * one artifact; `"collect"` gathers competing candidates (variant fan-out).
 * `onError` sets the per-item failure policy: `"fail"` aborts the whole map on
 * the first error, `"skip"` drops failed items, `"collect"` keeps them as
 * `{ error, index }` entries (collect mode only).
 */
const MapConfig = z.object({
  over: ExprSchema,
  /** id of the sub-flow run per item. */
  body: z.string(),
  concurrency: z.number().int().positive().default(4),
  aggregate: z.enum(["merge", "collect"]).default("collect"),
  onError: z.enum(["fail", "skip", "collect"]).default("fail"),
  writeTo: z.string().optional(),
});

/**
 * Explicit synchronization barrier. By default a node with several incoming
 * edges fires on ANY edge (OR-join) — which is what loop / branch re-entry
 * needs. A `join` instead waits for multiple parallel branches: `all` (every
 * incoming branch), `any` (first wins), or `quorum` (first `count`).
 */
const JoinConfig = z.object({
  mode: z.enum(["all", "any", "quorum"]).default("all"),
  /** Required when mode is "quorum": how many branches must arrive. */
  count: z.number().int().positive().optional(),
  writeTo: z.string().optional(),
});

// --- data -------------------------------------------------------------------

/** Deterministic function: a registered handler (`ref`) or inline source. */
const CodeConfig = z
  .object({
    ref: z.string().optional(),
    inline: z.string().optional(),
    writeTo: z.string().optional(),
  })
  .refine((c) => Boolean(c.ref) || Boolean(c.inline), {
    message: "code node requires either 'ref' or 'inline'",
  });

/** RAG retrieval from a vector store / knowledge source. */
const RetrieveConfig = z.object({
  store: z.string(),
  query: ExprSchema,
  topK: z.number().int().positive().default(5),
  writeTo: z.string().optional(),
});

/** Pure expression evaluation (reshape / extract state). */
const TransformConfig = z.object({
  expr: ExprSchema,
  writeTo: z.string().optional(),
});

// --- tool -------------------------------------------------------------------

/**
 * Invoke a registered tool. `tier` + `requiresApproval` encode the read vs
 * write distinction: read/content auto-run; write/bulk/dangerous route through
 * a human node first. `resource` binds the call to a declared resource session.
 */
const ToolConfig = z.object({
  tool: z.string(),
  args: z.record(ExprSchema).default({}),
  tier: ToolTierSchema.optional(),
  requiresApproval: z.boolean().default(false),
  resource: z.string().optional(),
  writeTo: z.string().optional(),
});

// --- human ------------------------------------------------------------------

/**
 * Durable pause for a human. Modes:
 * - `approve`: confirm/reject a proposed change. Handles: "approved"/"rejected".
 * - `select`: pick one of N candidates. Handle: "next".
 * - `annotate`: leave feedback and continue. Handle: "next".
 * - `collect`: ask a free-text question and capture the reply into `writeTo`.
 *   Wrap in a `loop` for a multi-turn intake that runs until a spec is complete.
 *   Handle: "next".
 *
 * `exits` overrides the default handles for a custom gate — e.g. a 3-way review
 * `["approved", "changes", "rejected"]` where the "changes" branch carries the
 * user's free-text feedback (via `writeTo`) back to an orchestrator.
 */
const HumanConfig = z.object({
  mode: z.enum(["approve", "select", "annotate", "collect"]),
  prompt: z.string().optional(),
  /** Custom output handles; overrides the mode's defaults. */
  exits: z.array(z.string()).min(1).optional(),
  /** Time-to-live for the pending decision, in seconds. */
  ttl: z.number().int().positive().optional(),
  writeTo: z.string().optional(),
});

// --- composite --------------------------------------------------------------

/**
 * Run another flow as a node (nested agent / sub-agent composition).
 *
 * A dynamic supervisor — an orchestrator that invents a task list at runtime
 * and dispatches each task to a different specialist — is expressed as
 * `map(over: tasks) -> switch(on: task.type) -> subflow`, not a dedicated
 * primitive: the worker is selected per item inside the map body.
 */
const SubflowConfig = z.object({
  flow: z.string(),
  inputs: z.record(ExprSchema).default({}),
  writeTo: z.string().optional(),
});

// --- catalog ----------------------------------------------------------------

export interface NodeSpec {
  type: string;
  category: NodeCategory;
  description: string;
  configSchema: z.ZodTypeAny;
  /** Static output handles, or "dynamic" when derived from config. */
  outputs: readonly string[] | "dynamic";
}

const BUILTIN_SPECS: readonly NodeSpec[] = [
  {
    type: "input",
    category: "io",
    description: "Flow entry point; declares the input contract.",
    configSchema: InputConfig,
    outputs: ["out"],
  },
  {
    type: "output",
    category: "io",
    description: "Flow exit point; surfaces a value as the run result.",
    configSchema: OutputConfig,
    outputs: [],
  },
  {
    type: "agent",
    category: "model",
    description: "Model call with optional tool-use loop and structured output.",
    configSchema: AgentConfig,
    outputs: ["out"],
  },
  {
    type: "router",
    category: "model",
    description: "Reads the input and routes it to one of several named branches.",
    configSchema: RouterConfig,
    outputs: "dynamic",
  },
  {
    type: "branch",
    category: "control",
    description: "Boolean split.",
    configSchema: BranchConfig,
    outputs: ["true", "false"],
  },
  {
    type: "switch",
    category: "control",
    description: "Multi-way split over named cases.",
    configSchema: SwitchConfig,
    outputs: "dynamic",
  },
  {
    type: "loop",
    category: "control",
    description: "Bounded loop over a sub-flow body (reflection / optimizer).",
    configSchema: LoopConfig,
    outputs: ["out"],
  },
  {
    type: "map",
    category: "control",
    description: "Concurrent fan-out over a collection with aggregation.",
    configSchema: MapConfig,
    outputs: ["out"],
  },
  {
    type: "join",
    category: "control",
    description: "Synchronization barrier (all / any / quorum) for parallel branches.",
    configSchema: JoinConfig,
    outputs: ["out"],
  },
  {
    type: "code",
    category: "data",
    description: "Deterministic function (registered handler or inline).",
    configSchema: CodeConfig,
    outputs: ["out"],
  },
  {
    type: "retrieve",
    category: "data",
    description: "RAG retrieval from a vector store.",
    configSchema: RetrieveConfig,
    outputs: ["out"],
  },
  {
    type: "transform",
    category: "data",
    description: "Pure expression evaluation over state.",
    configSchema: TransformConfig,
    outputs: ["out"],
  },
  {
    type: "tool",
    category: "tool",
    description: "Invoke a registered tool (tiers + approval + resource).",
    configSchema: ToolConfig,
    outputs: ["out"],
  },
  {
    type: "human",
    category: "human",
    description: "Durable human-in-the-loop pause (approve / select / annotate).",
    configSchema: HumanConfig,
    outputs: "dynamic",
  },
  {
    type: "subflow",
    category: "composite",
    description: "Run another flow as a node (sub-agent composition).",
    configSchema: SubflowConfig,
    outputs: ["out"],
  },
];

const REGISTRY = new Map<string, NodeSpec>(
  BUILTIN_SPECS.map((spec) => [spec.type, spec]),
);

/** Register a plugin node type (or override a built-in). */
export function registerNodeSpec(spec: NodeSpec): void {
  REGISTRY.set(spec.type, spec);
}

export function getNodeSpec(type: string): NodeSpec | undefined {
  return REGISTRY.get(type);
}

export function listNodeSpecs(): NodeSpec[] {
  return [...REGISTRY.values()];
}

export const BUILTIN_NODE_TYPES = BUILTIN_SPECS.map((s) => s.type);

/**
 * Resolve the concrete output handles of a node instance, expanding "dynamic"
 * specs (router classes, switch cases, human modes) from its config.
 */
export function resolveNodeOutputs(type: string, config: unknown): string[] {
  const spec = getNodeSpec(type);
  if (!spec) return [];
  if (spec.outputs !== "dynamic") return [...spec.outputs];

  const cfg = (config ?? {}) as Record<string, unknown>;
  if (type === "router" && Array.isArray(cfg.classes)) {
    const handles = (cfg.classes as RouterClass[]).map((c) => c.name);
    if (cfg.fallback) handles.push("fallback");
    return handles;
  }
  if (type === "switch" && Array.isArray(cfg.cases)) {
    const labels = (cfg.cases as unknown[]).map((c) =>
      typeof c === "string" ? c : String((c as { label?: unknown }).label ?? ""),
    );
    return [...labels, "default"];
  }
  if (type === "human") {
    if (Array.isArray(cfg.exits) && cfg.exits.length > 0) {
      return cfg.exits as string[];
    }
    return cfg.mode === "approve" ? ["approved", "rejected"] : ["next"];
  }
  return [];
}
