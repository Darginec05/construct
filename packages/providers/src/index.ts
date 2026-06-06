/** A tool advertised to the model so it can decide to call it. */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  parameters: Record<string, unknown>;
}

/** A model's request to invoke a tool, to be executed by the host. */
export interface ToolCall {
  /** Provider-assigned id; echoed back on the matching tool result. */
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export interface ChatOptions {
  model?: string;
  temperature?: number;
  /** Tools the model may call this turn. */
  tools?: ToolSpec[];
  toolChoice?: "auto" | "required" | "none";
  [key: string]: unknown;
}

/** One model turn: free text plus any tool calls the model wants run. */
export interface ChatResult {
  text: string;
  toolCalls?: ToolCall[];
}

/** Abstraction over a chat-capable model provider (OpenAI, Anthropic, Ollama, ...). */
export interface ModelProvider {
  id: string;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult>;
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
