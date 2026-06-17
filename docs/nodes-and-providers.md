# Nodes & Providers

## `@construct/nodes` ✅ — the model/tool-backed executors

The control-flow runtime lives in the engine; the leaf executors that reach
external systems live here, so the engine stays dependency-light. Registering
the package wires these executors into the engine registry:

| Executor | What it does |
|----------|--------------|
| `agent` | A model call that runs a bounded **tool-use loop**. Each turn the model either answers (text → loop ends) or requests tool calls, which are executed via `@construct/tools` and fed back as `tool` messages. Bounded by `maxSteps`; `toolChoice: "none"` collapses it to a single completion. |
| `classifier` | A cheap forced-structured-output decision; its `classes` are the output handles. |
| `tool` | Invokes one registered tool with evaluated `args`. |
| `retrieve` | RAG lookup against a named vector store (`@construct/rag`). |

The `agent` executor resolves declared tool names through `getTool(name)` and
advertises each as a `ToolSpec` to the provider. An unknown tool name fails the
run fast.

Both `agent` and `classifier` accept a **`PromptSource`** for their
`system`/`prompt` — an inline template or a `PromptRef` resolved at runtime via
`getPrompt(ref)`. A registry ref's declared `vars` are bound against run state
and interpolated into its body; a referenced prompt with no host resolver fails
the node. See [dsl.md](./dsl.md#prompt-sources) and
[engine.md](./engine.md#per-run-injection-providers--tools--prompts).

## `@construct/providers` ✅ — the model abstraction

A provider-neutral chat interface so a flow can mix models (Haiku for a router,
Sonnet for the worker) — `model` is per-node via `ModelRef`.

```ts
interface ModelProvider {
  id: string;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult>;
}
registerProvider(p); getProvider(id); listProviders();
```

- **`ChatMessage`** roles: `system` | `user` | `assistant` (+`toolCalls`) | `tool`.
- **`ChatOptions`**: `model`, `temperature`, `maxTokens`, `tools` (`ToolSpec[]`),
  `toolChoice`, `onDelta` (streaming), plus provider-specific extras.
- **`ChatResult`**: `text`, `toolCalls?`, `stopReason?`, `usage?`
  (`{ inputTokens, outputTokens }`).

`ToolSpec` / `ToolCall` are the wire shapes between the model and the host:
a `ToolSpec` advertises a callable (`name`, `description`, JSON-Schema
`parameters`); a `ToolCall` is the model's request to invoke one.

### Built-in providers

| Provider | id | Notes |
|----------|-----|-------|
| Anthropic | `anthropic` | needs `ANTHROPIC_API_KEY` or an explicit key |
| OpenAI | `openai` | reasoning models (o1/o3) handled specially |
| Gemini | `gemini` | streaming + non-streaming |
| Fake | `fake` | scriptable, for tests and offline editor runs |

The `model` field of a `ModelRef` is a **free string** — the editor's model
picker surfaces curated per-provider suggestions but never restricts it, so new
models work the day they ship.
