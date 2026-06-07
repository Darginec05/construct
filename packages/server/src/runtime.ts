import { registerBuiltinNodes } from "@construct/nodes";
import { createFakeProvider, getProvider, registerProvider } from "@construct/providers";
import {
  createAnthropicProvider,
  createGeminiProvider,
  createOpenAIProvider,
} from "@construct/providers/node";

let registered = false;

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
  if (!getProvider("anthropic")) registerProvider(createAnthropicProvider());
  if (!getProvider("openai")) registerProvider(createOpenAIProvider());
  if (!getProvider("gemini")) registerProvider(createGeminiProvider());
}
