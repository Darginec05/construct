import Anthropic from "@anthropic-ai/sdk";
import type {
  ChatMessage,
  ChatOptions,
  ChatResult,
  ModelProvider,
  ToolCall,
} from "./index.js";

export interface AnthropicOptions {
  /** Provider id used in `model.provider`. Defaults to "anthropic". */
  id?: string;
  /** API key; falls back to the ANTHROPIC_API_KEY env var. */
  apiKey?: string;
  /** Override the API base. */
  baseUrl?: string;
  /** Required by the API; used when a call does not specify one. */
  defaultMaxTokens?: number;
  /** Abort a request that takes longer than this. Defaults to 60_000ms. */
  timeoutMs?: number;
  /** Automatic retries on transient failures. Defaults to the SDK's default. */
  maxRetries?: number;
  /** Injected for testing; defaults to the global fetch. */
  fetch?: typeof fetch;
}

/**
 * Fold our flat message list into Anthropic's request params. Pure, so it can
 * be unit-tested without touching the network.
 */
export function buildParams(
  messages: ChatMessage[],
  opts: ChatOptions,
  defaultMaxTokens: number,
): Anthropic.MessageCreateParamsNonStreaming {
  const systemParts: string[] = [];
  const apiMessages: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemParts.push(msg.content);
      continue;
    }
    if (msg.role === "user") {
      apiMessages.push({ role: "user", content: msg.content });
      continue;
    }
    if (msg.role === "assistant") {
      // Text-only turns stay a plain string; tool calls need the block form.
      if (!msg.toolCalls || msg.toolCalls.length === 0) {
        apiMessages.push({ role: "assistant", content: msg.content });
        continue;
      }
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (msg.content) blocks.push({ type: "text", text: msg.content });
      for (const call of msg.toolCalls) {
        blocks.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: call.arguments,
        });
      }
      apiMessages.push({ role: "assistant", content: blocks });
      continue;
    }
    // tool result: merge into the preceding user turn when it is a block array,
    // since Anthropic groups parallel tool_results into one user message.
    const block: Anthropic.ToolResultBlockParam = {
      type: "tool_result",
      tool_use_id: msg.toolCallId,
      content: msg.content,
    };
    const last = apiMessages[apiMessages.length - 1];
    if (last && last.role === "user" && Array.isArray(last.content)) {
      last.content.push(block);
    } else {
      apiMessages.push({ role: "user", content: [block] });
    }
  }

  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: opts.model ?? "",
    max_tokens: Number(opts.maxTokens ?? defaultMaxTokens),
    messages: apiMessages,
  };
  if (systemParts.length > 0) params.system = systemParts.join("\n\n");
  if (typeof opts.temperature === "number") params.temperature = opts.temperature;
  if (opts.tools && opts.tools.length > 0) {
    params.tools = opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool.InputSchema,
    }));
    params.tool_choice = toToolChoice(opts.toolChoice);
  }
  return params;
}

function toToolChoice(choice: ChatOptions["toolChoice"]): Anthropic.ToolChoice {
  switch (choice) {
    case "required":
      return { type: "any" };
    case "none":
      return { type: "none" };
    default:
      return { type: "auto" };
  }
}

/** Map a completed Anthropic message back into our provider-neutral result. */
export function fromMessage(msg: Anthropic.Message): ChatResult {
  let text = "";
  const toolCalls: ToolCall[] = [];
  for (const block of msg.content) {
    if (block.type === "text") {
      text += block.text;
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: (block.input ?? {}) as Record<string, unknown>,
      });
    }
  }
  const result: ChatResult = { text };
  if (toolCalls.length > 0) result.toolCalls = toolCalls;
  if (msg.stop_reason) result.stopReason = msg.stop_reason;
  if (msg.usage) {
    result.usage = {
      inputTokens: msg.usage.input_tokens,
      outputTokens: msg.usage.output_tokens,
    };
  }
  return result;
}

/**
 * A {@link ModelProvider} backed by the official Anthropic SDK. The SDK handles
 * transport, retries, and SSE streaming; this module owns only the mapping to
 * and from our provider-neutral message shape. When {@link ChatOptions.onDelta}
 * is set the call streams and forwards each text chunk.
 */
export function createAnthropicProvider(
  options: AnthropicOptions = {},
): ModelProvider {
  const id = options.id ?? "anthropic";
  const defaultMaxTokens = options.defaultMaxTokens ?? 1024;
  const client = new Anthropic({
    apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY,
    ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
    timeout: options.timeoutMs ?? 60_000,
    ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  return {
    id,
    async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
      if (!opts.model) throw new Error(`provider "${id}": missing model`);
      const params = buildParams(messages, opts, defaultMaxTokens);

      if (opts.onDelta) {
        const stream = client.messages.stream(params);
        stream.on("text", (delta) => opts.onDelta!(delta));
        return fromMessage(await stream.finalMessage());
      }
      return fromMessage(await client.messages.create(params));
    },
  };
}
