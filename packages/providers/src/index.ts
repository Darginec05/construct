export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  [key: string]: unknown;
}

/** Abstraction over a chat-capable model provider (OpenAI, Anthropic, Ollama, ...). */
export interface ModelProvider {
  id: string;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
}

const registry = new Map<string, ModelProvider>();

export function registerProvider(provider: ModelProvider): void {
  registry.set(provider.id, provider);
}

export function getProvider(id: string): ModelProvider | undefined {
  return registry.get(id);
}

export function listProviders(): ModelProvider[] {
  return [...registry.values()];
}
