import {
  type Content,
  type FinishReason,
  FunctionCallingConfigMode,
  type GenerateContentConfig,
  type GenerateContentParameters,
  type GenerateContentResponse,
  type GenerateContentResponseUsageMetadata,
  GoogleGenAI,
  type Part,
  type Schema,
} from "@google/genai";
import type {
  ChatMessage,
  ChatOptions,
  ChatResult,
  ModelProvider,
  ToolCall,
} from "./index.js";

export interface GeminiOptions {
  /** Provider id used in `model.provider`. Defaults to "gemini". */
  id?: string;
  /** API key; falls back to GEMINI_API_KEY, then GOOGLE_API_KEY. */
  apiKey?: string;
  /** Override the API base (passed through as httpOptions.baseUrl). */
  baseUrl?: string;
  /** Cap applied when a call does not specify one; omitted if unset. */
  defaultMaxTokens?: number;
  /** Abort a request that takes longer than this. Defaults to 60_000ms. */
  timeoutMs?: number;
}

/** Gemini convention: a function response is a JSON object under an "output" key. */
function toResponseObject(content: string): Record<string, unknown> {
  if (!content) return {};
  try {
    const parsed: unknown = JSON.parse(content);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // not JSON — fall through to the wrapped form
  }
  return { output: content };
}

function toMode(choice: ChatOptions["toolChoice"]): FunctionCallingConfigMode {
  switch (choice) {
    case "required":
      return FunctionCallingConfigMode.ANY;
    case "none":
      return FunctionCallingConfigMode.NONE;
    default:
      return FunctionCallingConfigMode.AUTO;
  }
}

/**
 * Fold our flat message list into Gemini's request params. Pure, so it can be
 * unit-tested without touching the network.
 *
 * Gemini differs from the OpenAI/Anthropic shapes in three ways handled here:
 * system prompts move to `config.systemInstruction`; the assistant role is
 * named "model"; and a tool result is a `functionResponse` keyed by the
 * function *name*, which we recover from the preceding model turn's calls.
 */
export function buildParams(
  messages: ChatMessage[],
  opts: ChatOptions,
  defaultMaxTokens?: number,
): GenerateContentParameters {
  const systemParts: string[] = [];
  const contents: Content[] = [];
  // tool results carry only an id; recover the function name from the call.
  const nameById = new Map<string, string>();

  for (const msg of messages) {
    if (msg.role === "system") {
      systemParts.push(msg.content);
      continue;
    }
    if (msg.role === "user") {
      contents.push({ role: "user", parts: [{ text: msg.content }] });
      continue;
    }
    if (msg.role === "assistant") {
      const parts: Part[] = [];
      if (msg.content) parts.push({ text: msg.content });
      for (const call of msg.toolCalls ?? []) {
        nameById.set(call.id, call.name);
        parts.push({
          functionCall: { id: call.id, name: call.name, args: call.arguments },
        });
      }
      contents.push({ role: "model", parts });
      continue;
    }
    // tool result → functionResponse; Gemini groups parallel results in one turn.
    const part: Part = {
      functionResponse: {
        id: msg.toolCallId,
        name: nameById.get(msg.toolCallId) ?? "",
        response: toResponseObject(msg.content),
      },
    };
    const last = contents[contents.length - 1];
    if (last?.role === "user" && last.parts?.[0]?.functionResponse) {
      last.parts.push(part);
    } else {
      contents.push({ role: "user", parts: [part] });
    }
  }

  const config: GenerateContentConfig = {};
  if (systemParts.length > 0) config.systemInstruction = systemParts.join("\n\n");
  if (typeof opts.temperature === "number") config.temperature = opts.temperature;
  const maxTokens = opts.maxTokens ?? defaultMaxTokens;
  if (typeof maxTokens === "number") config.maxOutputTokens = maxTokens;
  if (opts.tools && opts.tools.length > 0) {
    config.tools = [
      {
        functionDeclarations: opts.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters as unknown as Schema,
        })),
      },
    ];
    config.toolConfig = {
      functionCallingConfig: { mode: toMode(opts.toolChoice) },
    };
  }

  return { model: opts.model ?? "", contents, config };
}

/** Map a Gemini response (or accumulated stream) back into our neutral result. */
export function fromResponse(response: GenerateContentResponse): ChatResult {
  const candidate = response.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  let text = "";
  const toolCalls: ToolCall[] = [];
  let synthetic = 0;
  for (const part of parts) {
    if (typeof part.text === "string") {
      text += part.text;
    } else if (part.functionCall) {
      const fc = part.functionCall;
      toolCalls.push({
        // Gemini omits the id on the public API; synthesize a stable one so the
        // host can round-trip the result back (buildParams maps id -> name).
        id: fc.id ?? `call_${synthetic++}`,
        name: fc.name ?? "",
        arguments: fc.args ?? {},
      });
    }
  }
  const result: ChatResult = { text };
  if (toolCalls.length > 0) result.toolCalls = toolCalls;
  if (candidate?.finishReason) result.stopReason = candidate.finishReason;
  const usage = response.usageMetadata;
  if (usage) {
    result.usage = {
      inputTokens: usage.promptTokenCount ?? 0,
      outputTokens: usage.candidatesTokenCount ?? 0,
    };
  }
  return result;
}

/**
 * A {@link ModelProvider} backed by the official Google GenAI SDK. The SDK owns
 * transport and SSE streaming; this module owns only the mapping to and from our
 * provider-neutral message shape. When {@link ChatOptions.onDelta} is set the
 * call streams and forwards each text chunk.
 *
 * Unlike the OpenAI/Anthropic SDKs, this one exposes no custom-fetch or
 * max-retries hook, so those are not surfaced here; the pure mappers above
 * remain fully testable without the network.
 */
export function createGeminiProvider(options: GeminiOptions = {}): ModelProvider {
  const id = options.id ?? "gemini";
  const client = new GoogleGenAI({
    apiKey:
      options.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY,
    httpOptions: {
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
      timeout: options.timeoutMs ?? 60_000,
    },
  });

  return {
    id,
    async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
      if (!opts.model) throw new Error(`provider "${id}": missing model`);
      const params = buildParams(messages, opts, options.defaultMaxTokens);

      if (opts.onDelta) {
        const stream = await client.models.generateContentStream(params);
        // No final-response helper here: accumulate parts ourselves, forwarding
        // text deltas as they arrive, then reuse fromResponse on the merge.
        const parts: Part[] = [];
        let finishReason: FinishReason | undefined;
        let usageMetadata: GenerateContentResponseUsageMetadata | undefined;
        for await (const chunk of stream) {
          const candidate = chunk.candidates?.[0];
          for (const part of candidate?.content?.parts ?? []) {
            if (typeof part.text === "string") opts.onDelta(part.text);
            parts.push(part);
          }
          if (candidate?.finishReason) finishReason = candidate.finishReason;
          if (chunk.usageMetadata) usageMetadata = chunk.usageMetadata;
        }
        return fromResponse({
          candidates: [{ content: { role: "model", parts }, finishReason }],
          usageMetadata,
        } as GenerateContentResponse);
      }
      return fromResponse(await client.models.generateContent(params));
    },
  };
}
