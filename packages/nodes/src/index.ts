import {
  registerExecutor,
  type ExecutorContext,
  type ExecutorResult,
} from "@construct/engine";
import {
  getProvider,
  type ChatMessage,
  type ToolSpec,
} from "@construct/providers";
import { getTool, needsApproval, runTool } from "@construct/tools";
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

function requireProvider(model: ModelRef | undefined, node: string) {
  if (!model) throw new Error(`${node} node: missing "model"`);
  const provider = getProvider(model.provider);
  if (!provider) throw new Error(`${node} node: no provider "${model.provider}"`);
  return provider;
}

/** Structured output: try to parse JSON when a schema was requested. */
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

/** Resolve a node's declared tool names into specs to advertise to the model. */
function resolveTools(names: string[]): ToolSpec[] {
  return names.map((name) => {
    const impl = getTool(name);
    if (!impl) throw new Error(`agent node: no tool registered as "${name}"`);
    return {
      name: impl.name,
      description: impl.description,
      parameters: impl.parameters ?? { type: "object", properties: {} },
    };
  });
}

/**
 * `agent`: a model call that runs a multi-step tool-use loop. Each turn the
 * model may either answer (text, loop ends) or request tool calls, which we
 * execute and feed back as `tool` messages for the next turn. The loop is
 * bounded by `maxSteps`; `toolChoice: "none"` collapses it to one completion.
 */
async function agent(ctx: ExecutorContext): Promise<ExecutorResult> {
  const model = ctx.config.model as ModelRef | undefined;
  const provider = requireProvider(model, "agent");
  const toolNames = (ctx.config.tools as string[] | undefined) ?? [];
  const toolChoice =
    (ctx.config.toolChoice as "auto" | "required" | "none" | undefined) ??
    "auto";
  const tools = toolChoice === "none" ? [] : resolveTools(toolNames);
  const maxSteps = Math.max(1, Number(ctx.config.maxSteps ?? 8));

  const messages: ChatMessage[] = [];
  if (typeof ctx.config.system === "string") {
    messages.push({ role: "system", content: ctx.config.system });
  }
  const prompt = ctx.evaluate(ctx.config.prompt);
  messages.push({ role: "user", content: prompt == null ? "" : String(prompt) });

  let text = "";
  let pendingTools = false;
  for (let step = 0; step < maxSteps; step++) {
    const res = await provider.chat(messages, {
      model: model!.model,
      temperature: model!.temperature,
      maxTokens: model!.maxTokens,
      tools: tools.length > 0 ? tools : undefined,
      toolChoice: tools.length > 0 ? toolChoice : undefined,
      onDelta: (text) => ctx.onDelta(text),
    });
    text = res.text;
    if (!res.toolCalls || res.toolCalls.length === 0) {
      pendingTools = false;
      break;
    }
    pendingTools = true;

    messages.push({ role: "assistant", content: res.text, toolCalls: res.toolCalls });
    // A bad tool name or a throwing tool is the model's problem, not the run's:
    // feed the error back as a `tool` message so the loop can recover, rather
    // than aborting the whole flow.
    const results = await Promise.all(
      res.toolCalls.map(async (call) => {
        const impl = getTool(call.name);
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
        const result = await runTool(impl, call.arguments);
        const content = result.ok
          ? typeof result.output === "string"
            ? result.output
            : JSON.stringify(result.output)
          : `Error: ${result.error}`;
        return { call, content };
      }),
    );
    for (const { call, content } of results) {
      messages.push({ role: "tool", toolCallId: call.id, content });
    }
  }
  if (pendingTools) {
    throw new Error(
      `agent node: tool-use loop hit maxSteps (${maxSteps}) with the model still requesting tools`,
    );
  }
  return patch(ctx.config.writeTo, parseOutput(ctx.config.output, text));
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
  const provider = requireProvider(model, "router");
  const classes = (ctx.config.classes as RouterClass[]) ?? [];
  const fallback = ctx.config.fallback === true;
  const names = classes.map((c) => c.name);
  const choices = fallback ? [...names, ROUTER_FALLBACK] : names;
  const prompt = ctx.evaluate(ctx.config.prompt);

  const res = await provider.chat(
    [
      {
        role: "system",
        content:
          `Route the input to exactly one branch by calling the ${ROUTE_TOOL} tool. ` +
          `Pick the branch whose description best matches the input.\n\n` +
          describeClasses(classes, fallback),
      },
      { role: "user", content: prompt == null ? "" : String(prompt) },
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

  const chosen = matchClass(picked, choices) ?? (fallback ? ROUTER_FALLBACK : names[0] ?? "out");
  return { ...patch(ctx.config.writeTo, chosen), handle: chosen };
}

/** `tool`: invoke a registered tool with evaluated args. */
async function tool(ctx: ExecutorContext): Promise<ExecutorResult> {
  const name = ctx.config.tool as string;
  const impl = getTool(name);
  if (!impl) throw new Error(`tool node: no tool registered as "${name}"`);
  const args = ctx.evaluate(ctx.config.args ?? {});
  // Gated tools (write/bulk/dangerous or requiresApproval) need explicit human
  // approval. Unlike the agent loop there's no model to recover from a denial,
  // so fail the node — fail safe by denying when no approver is wired.
  if (needsApproval(impl)) {
    const decision = ctx.requestApproval
      ? await ctx.requestApproval({ tool: impl.name, tier: impl.tier, args })
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
