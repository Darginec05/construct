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
  maxTokens?: number;
  /** Tools the model may call this turn. */
  tools?: ToolSpec[];
  toolChoice?: "auto" | "required" | "none";
  /** Called with each text chunk as it streams in. Providers may ignore it. */
  onDelta?: (text: string) => void;
  [key: string]: unknown;
}

/** Token accounting for one model turn. */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

/** One model turn: free text plus any tool calls the model wants run. */
export interface ChatResult {
  text: string;
  toolCalls?: ToolCall[];
  /** Why the model stopped (e.g. "end_turn", "tool_use", "max_tokens"). */
  stopReason?: string;
  usage?: Usage;
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

// SDK-backed providers (Anthropic / OpenAI / Gemini) live behind the
// `@construct/providers/node` entry point so this barrel stays free of the
// Node-only SDKs — browser bundles (the editor) can import the registry and the
// fake provider without pulling the SDKs into the module graph.
export {
  createFakeProvider,
  type FakeOptions,
  type FakeProvider,
  type FakeCall,
  type ScriptStep,
} from "./fake.js";
