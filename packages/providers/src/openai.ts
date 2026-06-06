import OpenAI from "openai";
import type {
  ChatMessage,
  ChatOptions,
  ChatResult,
  ModelProvider,
  ToolCall,
} from "./index.js";

export interface OpenAIOptions {
  /** Provider id used in `model.provider`. Defaults to "openai". */
  id?: string;
  /** API key; falls back to the OPENAI_API_KEY env var. */
  apiKey?: string;
  /**
   * Override the API base. Also the hook for OpenAI-compatible backends
   * (Ollama, Groq, Together, OpenRouter, vLLM, …): point this at their
   * `/v1` endpoint and pass the matching `model`.
   */
  baseUrl?: string;
  /** Cap applied when a call does not specify one; omitted if unset. */
  defaultMaxTokens?: number;
  /** Abort a request that takes longer than this. Defaults to 60_000ms. */
  timeoutMs?: number;
  /** Automatic retries on transient failures. Defaults to the SDK's default. */
  maxRetries?: number;
  /** Injected for testing; defaults to the global fetch. */
  fetch?: typeof fetch;
}

/**
 * Fold our flat message list into OpenAI's request params. Pure, so it can be
 * unit-tested without touching the network.
 *
 * Two shape differences from Anthropic worth noting: system prompts stay as
 * messages (not a top-level field), and tool-call arguments travel as a JSON
 * string rather than an object.
 */
export function buildParams(
  messages: ChatMessage[],
  opts: ChatOptions,
  defaultMaxTokens?: number,
): OpenAI.Chat.ChatCompletionCreateParamsNonStreaming {
  const apiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      apiMessages.push({ role: "system", content: msg.content });
      continue;
    }
    if (msg.role === "user") {
      apiMessages.push({ role: "user", content: msg.content });
      continue;
    }
    if (msg.role === "assistant") {
      // Text-only turns omit tool_calls entirely.
      if (!msg.toolCalls || msg.toolCalls.length === 0) {
        apiMessages.push({ role: "assistant", content: msg.content });
        continue;
      }
      apiMessages.push({
        role: "assistant",
        // null (not "") when a turn is purely tool calls.
        content: msg.content || null,
        tool_calls: msg.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: {
            name: call.name,
            arguments: JSON.stringify(call.arguments),
          },
        })),
      });
      continue;
    }
    // tool result: one message per result, keyed by the originating call id.
    // OpenAI does not group parallel results into a single turn.
    apiMessages.push({
      role: "tool",
      tool_call_id: msg.toolCallId,
      content: msg.content,
    });
  }

  const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
    model: opts.model ?? "",
    messages: apiMessages,
  };
  const maxTokens = opts.maxTokens ?? defaultMaxTokens;
  if (typeof maxTokens === "number") params.max_tokens = maxTokens;
  if (typeof opts.temperature === "number") params.temperature = opts.temperature;
  if (opts.tools && opts.tools.length > 0) {
    params.tools = opts.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
    params.tool_choice = toToolChoice(opts.toolChoice);
  }
  return params;
}

function toToolChoice(
  choice: ChatOptions["toolChoice"],
): OpenAI.Chat.ChatCompletionToolChoiceOption {
  switch (choice) {
    case "required":
      return "required";
    case "none":
      return "none";
    default:
      return "auto";
  }
}

/** Best-effort decode of the JSON-string tool arguments OpenAI returns. */
function parseArguments(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // A truncated response (e.g. hit max_tokens) can leave malformed JSON.
    return {};
  }
}

/** Map a completed OpenAI chat completion back into our provider-neutral result. */
export function fromCompletion(
  completion: OpenAI.Chat.ChatCompletion,
): ChatResult {
  const choice = completion.choices[0];
  const message = choice?.message;
  const toolCalls: ToolCall[] = [];
  for (const call of message?.tool_calls ?? []) {
    if (call.type !== "function") continue;
    toolCalls.push({
      id: call.id,
      name: call.function.name,
      arguments: parseArguments(call.function.arguments),
    });
  }
  const result: ChatResult = { text: message?.content ?? "" };
  if (toolCalls.length > 0) result.toolCalls = toolCalls;
  if (choice?.finish_reason) result.stopReason = choice.finish_reason;
  if (completion.usage) {
    result.usage = {
      inputTokens: completion.usage.prompt_tokens,
      outputTokens: completion.usage.completion_tokens,
    };
  }
  return result;
}

/**
 * A {@link ModelProvider} backed by the official OpenAI SDK. The SDK handles
 * transport, retries, and SSE streaming; this module owns only the mapping to
 * and from our provider-neutral message shape. When {@link ChatOptions.onDelta}
 * is set the call streams and forwards each text chunk.
 *
 * Prompt caching is automatic server-side for long shared prefixes, so there is
 * no per-request cache flag. Reasoning models (o1/o3) expect
 * `max_completion_tokens` and reject `temperature`; supporting them is left for
 * a later iteration.
 */
export function createOpenAIProvider(
  options: OpenAIOptions = {},
): ModelProvider {
  const id = options.id ?? "openai";
  const client = new OpenAI({
    apiKey: options.apiKey ?? process.env.OPENAI_API_KEY,
    ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
    timeout: options.timeoutMs ?? 60_000,
    ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  return {
    id,
    async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
      if (!opts.model) throw new Error(`provider "${id}": missing model`);
      const params = buildParams(messages, opts, options.defaultMaxTokens);

      if (opts.onDelta) {
        // The `.stream()` helper (with tool-call + usage aggregation) lives on
        // the beta namespace in this SDK version. Drop the non-streaming
        // `stream` field so the params satisfy the helper's shape.
        const { stream: _drop, ...streamable } = params;
        const stream = client.beta.chat.completions.stream({
          ...streamable,
          stream_options: { include_usage: true },
        });
        stream.on("content", (delta) => opts.onDelta!(delta));
        return fromCompletion(await stream.finalChatCompletion());
      }
      return fromCompletion(await client.chat.completions.create(params));
    },
  };
}
