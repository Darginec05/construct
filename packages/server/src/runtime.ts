import { registerBuiltinNodes } from "@construct/nodes";
import {
  type ChatMessage,
  type ChatOptions,
  type ChatResult,
  createFakeProvider,
  getProvider,
  type ModelProvider,
  registerProvider,
} from "@construct/providers";
import {
  createAnthropicProvider,
  createGeminiProvider,
  createOpenAIProvider,
} from "@construct/providers/node";

let registered = false;

/**
 * Defer SDK-client construction until the first `chat()`. Some SDK clients
 * (e.g. OpenAI) throw in their constructor when no API key is present, so we
 * cannot build them eagerly at startup. Wrapping keeps registration total —
 * every provider id resolves — while still surfacing a missing-key error at run
 * time, only for flows that actually target that provider.
 */
function lazyProvider(id: string, make: () => ModelProvider): ModelProvider {
  let real: ModelProvider | undefined;
  return {
    id,
    chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult> {
      real ??= make();
      return real.chat(messages, options);
    },
  };
}

/**
 * Wire the execution runtime: built-in node executors plus the model providers.
 *
 * The SDK providers construct lazily — they only reach for an API key when a
 * flow actually calls them — so registering all four here is safe even with no
 * keys set. A flow that targets `anthropic` without `ANTHROPIC_API_KEY` fails
 * at run time with a clear message; one that targets `fake` always works
 * offline. Idempotent, so it is cheap to call on every request.
 */
export function registerRuntime(): void {
  if (registered) return;
  registered = true;

  registerBuiltinNodes();

  if (!getProvider("fake")) registerProvider(createFakeProvider({ id: "fake" }));
  if (!getProvider("anthropic"))
    registerProvider(lazyProvider("anthropic", () => createAnthropicProvider()));
  if (!getProvider("openai"))
    registerProvider(lazyProvider("openai", () => createOpenAIProvider()));
  if (!getProvider("gemini"))
    registerProvider(lazyProvider("gemini", () => createGeminiProvider()));
}
