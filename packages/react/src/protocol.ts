/**
 * The public chat-stream protocol: a small, transport-agnostic contract for
 * streaming one assistant turn. A host (e.g. Construct Cloud) projects whatever
 * its engine emits into these frames; a client ({@link useChat}) consumes them.
 * Deliberately decoupled from any internal run/telemetry event shape so the wire
 * never leaks node config, prompts, or templates to an end user.
 *
 * Frames travel as SSE `data:` lines, each a single JSON-encoded event.
 */

/** Why a turn ended: a normal stop, or a pause waiting on human input. */
export type ChatFinishReason = "stop" | "paused";

/** Token accounting for a finished turn. */
export type ChatUsage = {
  inputTokens: number;
  outputTokens: number;
};

/** One frame of a streaming chat turn. Discriminated on `type`. */
export type ChatStreamEvent =
  | { type: "start" }
  | { type: "text-delta"; delta: string }
  | { type: "finish"; reason: ChatFinishReason; usage?: ChatUsage }
  | { type: "error"; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asUsage(value: unknown): ChatUsage | undefined {
  if (!isRecord(value)) return undefined;
  const { inputTokens, outputTokens } = value;
  if (typeof inputTokens !== "number" || typeof outputTokens !== "number") return undefined;
  return { inputTokens, outputTokens };
}

/**
 * Parse one SSE `data:` payload into a known {@link ChatStreamEvent}, or `null`
 * when it is malformed or unrecognized. Unknown event types are dropped rather
 * than thrown, so a forward-compatible producer can add frames without breaking
 * an older client.
 */
export function parseChatStreamEvent(data: string): ChatStreamEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  switch (parsed.type) {
    case "start":
      return { type: "start" };
    case "text-delta":
      return typeof parsed.delta === "string" ? { type: "text-delta", delta: parsed.delta } : null;
    case "finish": {
      const reason = parsed.reason === "paused" ? "paused" : "stop";
      return { type: "finish", reason, usage: asUsage(parsed.usage) };
    }
    case "error":
      return { type: "error", message: typeof parsed.message === "string" ? parsed.message : "stream error" };
    default:
      return null;
  }
}
