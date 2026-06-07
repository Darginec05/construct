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
import { getTool, runTool } from "@construct/tools";
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

/**
 * Pick the class the model named. Prefer a whole-word hit so "bill" doesn't
 * swallow "billing"; fall back to substring, then to the longest class first so
 * a more specific label wins over a prefix of it.
 */
function matchClass(text: string, classes: string[]): string | undefined {
  const ranked = [...classes].sort((a, b) => b.length - a.length);
  for (const c of ranked) {
    const word = new RegExp(`\\b${c.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (word.test(text)) return c;
  }
  return ranked.find((c) => text.includes(c.toLowerCase()));
}

/** `classifier`: forced choice among `classes`; the chosen class is the handle. */
async function classifier(ctx: ExecutorContext): Promise<ExecutorResult> {
  const model = ctx.config.model as ModelRef | undefined;
  const provider = requireProvider(model, "classifier");
  const classes = (ctx.config.classes as string[]) ?? [];
  const prompt = ctx.evaluate(ctx.config.prompt);

  const res = await provider.chat(
    [
      {
        role: "system",
        content: `Classify the input. Respond with exactly one of: ${classes.join(
          ", ",
        )}.`,
      },
      { role: "user", content: prompt == null ? "" : String(prompt) },
    ],
    { model: model!.model },
  );
  const text = res.text.trim().toLowerCase();

  const chosen = matchClass(text, classes) ?? classes[0] ?? "out";
  return { ...patch(ctx.config.writeTo, chosen), handle: chosen };
}

/** `tool`: invoke a registered tool with evaluated args. */
async function tool(ctx: ExecutorContext): Promise<ExecutorResult> {
  const name = ctx.config.tool as string;
  const impl = getTool(name);
  if (!impl) throw new Error(`tool node: no tool registered as "${name}"`);
  const args = ctx.evaluate(ctx.config.args ?? {});
  const result = await impl.run(args);
  return patch(ctx.config.writeTo, result);
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
  registerExecutor("classifier", classifier);
  registerExecutor("tool", tool);
  registerExecutor("retrieve", retrieve);
}

registerBuiltinNodes();
