import {
  registerExecutor,
  type ExecutorContext,
  type ExecutorResult,
} from "@construct/engine";
import {
  getProvider,
  type ChatMessage,
  type ChatOptions,
  type ChatResult,
  type ModelProvider,
  type ToolSpec,
} from "@construct/providers";
import {
  getTool,
  higherTier,
  needsApproval,
  runTool,
  type Tool,
  type ToolTier,
} from "@construct/tools";
import { getStore } from "@construct/rag";

/**
 * Built-in leaf-node executors. These are the node types that need external
 * dependencies (models, tools), so they live here rather than in the engine,
 * which stays a dependency-free runtime. Importing this package registers them;
 * `registerBuiltinNodes()` is also exported for explicit/idempotent wiring.
 */

interface ModelRef {
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

function patch(writeTo: unknown, value: unknown): ExecutorResult {
  return typeof writeTo === "string" ? { patch: { [writeTo]: value } } : {};
}

/** A reference to a registry-managed prompt, as carried in the DSL. */
interface PromptRef {
  ref: string;
  vars?: Record<string, unknown>;
}

function isPromptRef(value: unknown): value is PromptRef {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { ref?: unknown }).ref === "string"
  );
}

/**
 * Resolve one prompt part to text. An inline template is interpolated against
 * run state; a {@link PromptRef} is fetched via `ctx.getPrompt`, its declared
 * `vars` bound (each evaluated against state), then its body interpolated
 * against `{ ...state, ...vars }`.
 */
function resolvePromptPart(ctx: ExecutorContext, part: unknown, node: string): string {
  if (part == null) return "";
  if (isPromptRef(part)) {
    const body = ctx.getPrompt?.(part.ref);
    if (body == null) {
      throw new Error(`${node} node: prompt "${part.ref}" is not available`);
    }
    const scope: Record<string, unknown> = {};
    if (part.vars) {
      for (const [key, expr] of Object.entries(part.vars)) {
        scope[key] = ctx.evaluate(expr);
      }
    }
    const out = ctx.evaluate(body, scope);
    return out == null ? "" : String(out);
  }
  const out = ctx.evaluate(part);
  return out == null ? "" : String(out);
}

/**
 * Resolve an agent `system` / `prompt` (or router `prompt`) source to text. A
 * single part is resolved directly; an ordered array (system layering) is
 * resolved part-by-part and joined with blank lines.
 */
function resolvePromptSource(ctx: ExecutorContext, src: unknown, node: string): string {
  if (Array.isArray(src)) {
    return src
      .map((part) => resolvePromptPart(ctx, part, node))
      .filter((text) => text !== "")
      .join("\n\n");
  }
  return resolvePromptPart(ctx, src, node);
}

function requireProvider(
  ctx: ExecutorContext,
  model: ModelRef | undefined,
  node: string,
): ModelProvider {
  if (!model) throw new Error(`${node} node: missing "model"`);
  // Prefer the per-run provider the host injected (multi-tenant key isolation);
  // fall back to the process-global registry for single-tenant / OSS hosts.
  const provider =
    (ctx.getProvider?.(model.provider) as ModelProvider | undefined) ??
    getProvider(model.provider);
  if (!provider) throw new Error(`${node} node: no provider "${model.provider}"`);
  return provider;
}

/** Backstop parse: if a provider ignored the structured-output tool and answered
 *  in prose, try to read JSON out of the text rather than silently dropping it. */
function parseOutput(output: unknown, text: string): unknown {
  if (output && typeof output === "object" && "schema" in output) {
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }
  return text;
}

/** Tool the agent calls to return a final answer constrained to `output.schema`. */
const RESPOND_TOOL = "respond";
/** Cap on a tool result fed back to the model, so one huge payload can't blow up
 *  context and cost. Truncated content keeps the head and flags the cut. */
const MAX_TOOL_RESULT_CHARS = 8000;
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 250;
const CALL_TIMEOUT_MS = 60_000;

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}… [truncated ${text.length - max} chars]`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Race a promise against a timeout so a hung provider call can't stall a run. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`model call timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Call the model with bounded retries and exponential backoff. LLM endpoints
 * are flaky (rate limits, transient 5xx, network blips); one failure shouldn't
 * abort the whole run, so retry a few times before giving up.
 */
async function chatWithRetry(
  provider: ModelProvider,
  messages: ChatMessage[],
  opts: ChatOptions,
): Promise<ChatResult> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      return await withTimeout(provider.chat(messages, opts), CALL_TIMEOUT_MS);
    } catch (err) {
      lastErr = err;
      if (attempt < RETRY_ATTEMPTS - 1) await delay(RETRY_BASE_MS * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Build the structured-output tool from `output.schema`. Providers constrain the
 * tool-call arguments to this JSON Schema, so the captured args are schema-shaped
 * by construction — no separate validator needed. Tool inputs must be objects, so
 * a non-object schema is wrapped under `value` and unwrapped on capture. `$schema`
 * is stripped since it isn't a valid tool-parameter key.
 */
function structuredTool(schema: Record<string, unknown>): {
  tool: ToolSpec;
  unwrap: (args: Record<string, unknown>) => unknown;
} {
  const { $schema: _drop, ...clean } = schema;
  const isObject = clean.type === "object" || "properties" in clean;
  const parameters = isObject
    ? clean
    : { type: "object", properties: { value: clean }, required: ["value"] };
  return {
    tool: {
      name: RESPOND_TOOL,
      description: "Return the final answer as structured data matching the schema.",
      parameters,
    },
    unwrap: isObject ? (args) => args : (args) => args.value,
  };
}

/**
 * Resolve a tool implementation by name: prefer the per-run tool set the host
 * injected (tenant-scoped / custom tools), then fall back to the process-global
 * registry. Mirrors provider resolution in {@link requireProvider}.
 */
function resolveToolImpl(ctx: ExecutorContext, name: string): Tool | undefined {
  return (ctx.getTool?.(name) as Tool | undefined) ?? getTool(name);
}

/** Resolve a node's declared tool names into specs to advertise to the model. */
function resolveTools(ctx: ExecutorContext, names: string[]): ToolSpec[] {
  return names.map((name) => {
    const impl = resolveToolImpl(ctx, name);
    if (!impl) throw new Error(`agent node: no tool registered as "${name}"`);
    return {
      name: impl.name,
      description: impl.description,
      parameters: impl.parameters ?? { type: "object", properties: {} },
    };
  });
}

type Budget = { maxTokens?: number; maxSteps?: number; maxUsd?: number };

/**
 * `agent`: a model call that runs a multi-step tool-use loop. Each turn the
 * model may answer, request tool calls (executed and fed back), or — when an
 * `output.schema` is set — commit a structured result via the `respond` tool.
 *
 * Production guarantees layered in here:
 * - structured output is provider-constrained (the `respond` tool's schema),
 *   not hoped-for JSON; the captured args are schema-shaped by construction.
 * - `toolChoice: "required"` forces a tool only on the first turn, then relaxes
 *   to "auto" so the loop can actually finish instead of looping to `maxSteps`.
 * - the model call is retried with backoff and bounded by a timeout.
 * - token usage is accumulated and bounded by `budget` (note: `maxUsd` needs a
 *   per-model price table this build doesn't ship, so it is not yet enforced).
 * - tool results are truncated before being fed back.
 */
async function agent(ctx: ExecutorContext): Promise<ExecutorResult> {
  const model = ctx.config.model as ModelRef | undefined;
  const provider = requireProvider(ctx, model, "agent");
  const toolNames = (ctx.config.tools as string[] | undefined) ?? [];
  const toolChoice =
    (ctx.config.toolChoice as "auto" | "required" | "none" | undefined) ?? "auto";
  const realTools = toolChoice === "none" ? [] : resolveTools(ctx, toolNames);

  const output = ctx.config.output;
  const schema =
    output && typeof output === "object" && "schema" in output
      ? ((output as { schema: Record<string, unknown> }).schema)
      : undefined;
  const structured = schema ? structuredTool(schema) : undefined;
  const tools = structured ? [...realTools, structured.tool] : realTools;

  const budget = ctx.config.budget as Budget | undefined;
  const stepCap = Math.max(
    1,
    Math.min(Number(ctx.config.maxSteps ?? 8), budget?.maxSteps ?? Number.POSITIVE_INFINITY),
  );

  const messages: ChatMessage[] = [];
  let system = resolvePromptSource(ctx, ctx.config.system, "agent");
  if (structured) {
    const note = `When you have the final answer, call the ${RESPOND_TOOL} tool with the structured result. Do not answer in plain text.`;
    system = system ? `${system}\n\n${note}` : note;
  }
  if (system) messages.push({ role: "system", content: system });
  const prompt = resolvePromptSource(ctx, ctx.config.prompt, "agent");
  messages.push({ role: "user", content: prompt });

  let totalTokens = 0;
  let finalText = "";
  let result: unknown;
  let gotResult = false;
  let pendingTools = false;

  for (let step = 0; step < stepCap; step++) {
    // On the final permitted step of a structured agent, drop the real tools and
    // offer only `respond`, so the loop always commits a schema-valid answer
    // rather than throwing when the model would otherwise keep calling tools. A
    // non-structured agent has no such fallback — its exhaustion stays an error.
    const lastStep = step === stepCap - 1;
    const stepTools = structured && lastStep ? [structured.tool] : tools;

    // Force a tool only on the first turn for "required" (commit to acting),
    // then relax so the model can finish. With a structured schema, keep forcing
    // a tool so the model can't answer in prose — it must call `respond`.
    const choice: "auto" | "required" | "none" =
      stepTools.length === 0
        ? "none"
        : structured
          ? "required"
          : toolChoice === "required"
            ? step === 0
              ? "required"
              : "auto"
            : toolChoice;

    const onPartial = ctx.onPartial;
    const res = await chatWithRetry(provider, messages, {
      model: model!.model,
      temperature: model!.temperature,
      maxTokens: model!.maxTokens,
      tools: stepTools.length > 0 ? stepTools : undefined,
      toolChoice: stepTools.length > 0 ? choice : undefined,
      onDelta: (text) => ctx.onDelta(text),
      // Stream the structured answer as it builds: forward the `respond` tool's
      // cumulative arguments for progressive rendering. Other tool calls (mid-loop
      // actions) are not the final answer, so they are ignored here.
      ...(structured && onPartial
        ? {
            onToolArgs: (name: string, json: string): void => {
              if (name === RESPOND_TOOL) onPartial(json);
            },
          }
        : {}),
    });

    if (res.usage) {
      totalTokens += res.usage.inputTokens + res.usage.outputTokens;
      ctx.onUsage?.(res.usage);
      if (budget?.maxTokens != null && totalTokens > budget.maxTokens) {
        throw new Error(
          `agent node: token budget exceeded (${totalTokens} > ${budget.maxTokens})`,
        );
      }
    }

    finalText = res.text;
    const calls = res.toolCalls ?? [];

    // Structured finish: the model committed the answer via `respond`.
    const respondCall = structured ? calls.find((c) => c.name === RESPOND_TOOL) : undefined;
    if (respondCall && structured) {
      result = structured.unwrap(respondCall.arguments);
      gotResult = true;
      pendingTools = false;
      break;
    }

    if (calls.length === 0) {
      pendingTools = false;
      break;
    }
    pendingTools = true;

    messages.push({ role: "assistant", content: res.text, toolCalls: calls });
    // A bad tool name or a throwing tool is the model's problem, not the run's:
    // feed the error back as a `tool` message so the loop can recover, rather
    // than aborting the whole flow.
    const results = await Promise.all(
      calls.map(async (call) => {
        const impl = resolveToolImpl(ctx, call.name);
        if (!impl) {
          return { call, content: `Error: unknown tool "${call.name}"` };
        }
        // Gated tools (write/bulk/dangerous or requiresApproval) need explicit
        // human approval. Fail safe: with no approver configured, deny.
        if (needsApproval(impl)) {
          const decision = ctx.requestApproval
            ? await ctx.requestApproval({
                tool: impl.name,
                tier: impl.tier,
                args: call.arguments,
              })
            : { approved: false, reason: "no approver configured" };
          if (!decision.approved) {
            const why = decision.reason ? ` (${decision.reason})` : "";
            return { call, content: `Error: tool "${impl.name}" was not approved${why}` };
          }
        }
        const ran = await runTool(impl, call.arguments);
        const content = ran.ok
          ? typeof ran.output === "string"
            ? ran.output
            : JSON.stringify(ran.output)
          : `Error: ${ran.error}`;
        return { call, content: truncate(content, MAX_TOOL_RESULT_CHARS) };
      }),
    );
    for (const { call, content } of results) {
      messages.push({ role: "tool", toolCallId: call.id, content });
    }
  }
  if (pendingTools) {
    throw new Error(
      `agent node: tool-use loop hit maxSteps (${stepCap}) with the model still requesting tools`,
    );
  }
  if (schema) {
    return patch(ctx.config.writeTo, gotResult ? result : parseOutput(ctx.config.output, finalText));
  }
  return patch(ctx.config.writeTo, finalText);
}

/** One branch of a router node: a handle name plus optional guidance. */
interface RouterClass {
  name: string;
  description?: string;
}

/** Reserved handle for the router's "no class fit" branch. */
const ROUTER_FALLBACK = "fallback";

/** Tool the router must call to commit to exactly one branch. */
const ROUTE_TOOL = "select_route";

/**
 * Resolve free text to one of `names`. Prefer an exact (case-insensitive) hit;
 * then a whole-word match so "bill" doesn't swallow "billing"; then a substring,
 * longest name first so a more specific label wins over a prefix of it. Used to
 * canonicalize the model's pick and as a backstop when a provider answers in
 * prose instead of calling the tool.
 */
function matchClass(text: string, names: string[]): string | undefined {
  const lower = text.trim().toLowerCase();
  const exact = names.find((c) => c.toLowerCase() === lower);
  if (exact) return exact;
  const ranked = [...names].sort((a, b) => b.length - a.length);
  for (const c of ranked) {
    const word = new RegExp(`\\b${c.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (word.test(lower)) return c;
  }
  return ranked.find((c) => lower.includes(c.toLowerCase()));
}

/**
 * The forced-choice tool: a single `route` enum constrains the model to one of
 * the branch names, and a `reason` (asked first, so the model commits to a
 * rationale before the label) is streamed back for observability.
 */
function routeTool(choices: string[]): ToolSpec {
  return {
    name: ROUTE_TOOL,
    description: "Commit to exactly one branch for the input.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "One sentence: why this branch fits the input.",
        },
        route: {
          type: "string",
          enum: choices,
          description: "The branch to take. Must be one of the listed names.",
        },
      },
      required: ["reason", "route"],
    },
  };
}

/** Render the choices for the system prompt: "name — description" per line. */
function describeClasses(classes: RouterClass[], fallback: boolean): string {
  const lines = classes.map((c) =>
    c.description ? `- ${c.name}: ${c.description}` : `- ${c.name}`,
  );
  if (fallback) {
    lines.push(`- ${ROUTER_FALLBACK}: none of the above, or you are not confident.`);
  }
  return lines.join("\n");
}

/**
 * `router`: forced choice among `classes`; the chosen class name is the handle.
 * The model reads each class description and commits by calling the `select_route`
 * tool, whose `route` arg is an enum of the branch names — a constrained choice
 * that can't drift into prose. Routing runs at temperature 0 by default so the
 * same input always takes the same branch. When `fallback` is on, "none fit / not
 * confident" routes to the "fallback" handle instead of the first class.
 */
async function router(ctx: ExecutorContext): Promise<ExecutorResult> {
  const model = ctx.config.model as ModelRef | undefined;
  const provider = requireProvider(ctx, model, "router");
  const classes = (ctx.config.classes as RouterClass[]) ?? [];
  const fallback = ctx.config.fallback === true;
  const names = classes.map((c) => c.name);
  const choices = fallback ? [...names, ROUTER_FALLBACK] : names;
  const prompt = resolvePromptSource(ctx, ctx.config.prompt, "router");

  const res = await provider.chat(
    [
      {
        role: "system",
        content:
          `Route the input to exactly one branch by calling the ${ROUTE_TOOL} tool. ` +
          `Pick the branch whose description best matches the input.\n\n` +
          describeClasses(classes, fallback),
      },
      { role: "user", content: prompt },
    ],
    {
      model: model!.model,
      temperature: model!.temperature ?? 0,
      maxTokens: model!.maxTokens ?? 256,
      tools: [routeTool(choices)],
      toolChoice: "required",
    },
  );

  // Read the committed route from the tool call; if a provider ignored the
  // forced tool and answered in prose, fall back to matching its text.
  const call = res.toolCalls?.find((c) => c.name === ROUTE_TOOL);
  const picked =
    call && typeof call.arguments.route === "string" ? call.arguments.route : res.text;
  const reason =
    call && typeof call.arguments.reason === "string" ? call.arguments.reason : "";
  if (reason) ctx.onDelta(reason);

  // Canonicalize the model's pick to a real branch. When nothing matches —
  // a provider that ignored the forced tool and answered with an off-list label —
  // route to "fallback" if it exists (that branch is exactly for low-confidence
  // / no-fit input). With no fallback wired, fail loudly rather than silently
  // dumping every unparseable answer into the first branch.
  const matched = matchClass(picked, choices);
  if (matched === undefined && !fallback) {
    throw new Error(
      `router node: model did not return a listed route (got "${truncate(picked, 120)}"); ` +
        `enable the fallback option to route low-confidence inputs to a default branch`,
    );
  }
  const chosen = matched ?? ROUTER_FALLBACK;

  const writes: Record<string, unknown> = {};
  if (typeof ctx.config.writeTo === "string") writes[ctx.config.writeTo] = chosen;
  if (typeof ctx.config.reasonTo === "string") writes[ctx.config.reasonTo] = reason;
  return Object.keys(writes).length > 0 ? { patch: writes, handle: chosen } : { handle: chosen };
}

/** `tool`: invoke a registered tool with evaluated args. */
async function tool(ctx: ExecutorContext): Promise<ExecutorResult> {
  const name = ctx.config.tool as string;
  const impl = resolveToolImpl(ctx, name);
  if (!impl) throw new Error(`tool node: no tool registered as "${name}"`);
  const args = ctx.evaluate(ctx.config.args ?? {});
  // The node config can ESCALATE — never relax — the tool's intrinsic gating:
  // a flow author may force approval / a higher tier on a specific call, but a
  // node setting can't ungate an intrinsically dangerous tool. Stricter wins.
  const tier = higherTier(ctx.config.tier as ToolTier | undefined, impl.tier);
  const gate = {
    tier,
    requiresApproval: ctx.config.requiresApproval === true || impl.requiresApproval === true,
  };
  // Gated tools (write/bulk/dangerous or requiresApproval) need explicit human
  // approval. Unlike the agent loop there's no model to recover from a denial,
  // so fail the node — fail safe by denying when no approver is wired.
  if (needsApproval(gate)) {
    const decision = ctx.requestApproval
      ? await ctx.requestApproval({ tool: impl.name, tier, args })
      : { approved: false, reason: "no approver configured" };
    if (!decision.approved) {
      const why = decision.reason ? ` (${decision.reason})` : "";
      throw new Error(`tool node: "${impl.name}" was not approved${why}`);
    }
  }
  const result = await runTool(impl, args);
  if (!result.ok) throw new Error(`tool node: "${impl.name}" failed: ${result.error}`);
  return patch(ctx.config.writeTo, result.output);
}

/** `retrieve`: query a registered vector store and write back the matches. */
async function retrieve(ctx: ExecutorContext): Promise<ExecutorResult> {
  const name = ctx.config.store as string;
  const store = getStore(name);
  if (!store) throw new Error(`retrieve node: no store registered as "${name}"`);
  const query = ctx.evaluate(ctx.config.query);
  const topK = Math.max(1, Number(ctx.config.topK ?? 5));
  const docs = await store.query(query == null ? "" : String(query), topK);
  return patch(ctx.config.writeTo, docs);
}

export function registerBuiltinNodes(): void {
  registerExecutor("agent", agent);
  registerExecutor("router", router);
  registerExecutor("tool", tool);
  registerExecutor("retrieve", retrieve);
}

registerBuiltinNodes();
