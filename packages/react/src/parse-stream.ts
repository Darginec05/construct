import type { ChatStreamEvent } from "./protocol";
import { parseChatStreamEvent } from "./protocol";

/**
 * Read an open SSE response body and invoke `onEvent` for each recognized
 * {@link ChatStreamEvent}. Frames are split on the blank-line delimiter; only the
 * `data:` line of each frame is parsed (keep-alive comment frames are ignored).
 * Resolves when the producer closes the stream. Framework-agnostic on purpose so
 * {@link useChat} and any non-React consumer share one parser.
 *
 * The reader is cancelled on every exit — including when `onEvent` throws on an
 * `error` frame — so a partially-read SSE connection is always released.
 */
export async function parseChatStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const line = frame.split("\n").find((candidate) => candidate.startsWith("data:"));
        if (!line) continue;
        const event = parseChatStreamEvent(line.slice("data:".length).trim());
        if (event) onEvent(event);
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
