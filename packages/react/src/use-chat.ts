import type { ChangeEvent } from "react";
import { useCallback, useRef, useState } from "react";
import { parseChatStream } from "./parse-stream";
import type { ChatFinishReason, ChatUsage } from "./protocol";

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

/**
 * - `ready`: idle, accepting input.
 * - `submitting`: request sent, no assistant token yet.
 * - `streaming`: assistant tokens are arriving.
 * - `error`: the last turn failed.
 */
export type ChatStatus = "ready" | "submitting" | "streaming" | "error";

/** Settled turn handed to {@link UseChatOptions.onFinish}. */
export type ChatFinishEvent = {
  message: ChatMessage;
  /** `stop` for a normal completion, `paused` when the turn halted on a human node. */
  reason: ChatFinishReason;
  usage?: ChatUsage;
};

/** No frame for this long mid-stream → the turn is presumed stuck and aborted. */
const DEFAULT_STREAM_TIMEOUT_MS = 60_000;

export type UseChatOptions = {
  /** Endpoint a turn is POSTed to. Body is `{ message, ...body }`; replies stream back as SSE. */
  api: string;
  /** Seed transcript rendered before the first turn. */
  initialMessages?: ChatMessage[];
  /** Extra request headers (e.g. a token your BFF expects). */
  headers?: Record<string, string>;
  /** Extra fields merged into the POST body alongside `message`. */
  body?: Record<string, unknown>;
  /** Send credentials (cookies) with the request. Defaults to `false`. */
  withCredentials?: boolean;
  /** Abort a turn that goes this long without a frame. Defaults to 60s; `0` disables. */
  streamTimeoutMs?: number;
  onError?: (error: Error) => void;
  onFinish?: (event: ChatFinishEvent) => void;
};

export type UseChatHelpers = {
  messages: ChatMessage[];
  input: string;
  setInput: (value: string) => void;
  handleInputChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  /** Submit the current `input` as a turn (no-op while a turn is in flight or input is blank). */
  handleSubmit: (event?: { preventDefault?: () => void }) => void;
  /** Send an explicit message, bypassing `input`. */
  sendMessage: (text: string) => Promise<void>;
  status: ChatStatus;
  /** Reason the last turn ended, or null until one settles. `paused` means the thread awaits input. */
  finishReason: ChatFinishReason | null;
  error: Error | null;
  /** Abort the in-flight turn, if any. */
  stop: () => void;
};

function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Minimal `useChat` over the public chat-stream protocol. Sends a turn, appends a
 * placeholder assistant message, and grows it as `text-delta` frames arrive.
 * Transport details (history, threading, auth) live behind `api` — the host owns
 * conversation state, so the hook sends only the new message text.
 *
 * Options are read through a ref at call time, so the returned callbacks stay
 * stable even when the caller passes inline `headers`/`body`/handlers.
 */
export function useChat(options: UseChatOptions): UseChatHelpers {
  const [messages, setMessages] = useState<ChatMessage[]>(() => options.initialMessages ?? []);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<ChatStatus>("ready");
  const [finishReason, setFinishReason] = useState<ChatFinishReason | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback((): void => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const sendMessage = useCallback(async (text: string): Promise<void> => {
    const content = text.trim();
    if (!content || abortRef.current) return;

    const { api, headers, body, withCredentials, streamTimeoutMs, onError, onFinish } = optionsRef.current;

    const userMessage: ChatMessage = { id: createId(), role: "user", content };
    const assistant: ChatMessage = { id: createId(), role: "assistant", content: "" };
    setMessages((prev) => [...prev, userMessage, assistant]);
    setError(null);
    setFinishReason(null);
    setStatus("submitting");

    const controller = new AbortController();
    abortRef.current = controller;

    // Grow the assistant bubble from a local accumulator — the final text is read
    // back here (not from a state updater), so settle-time side effects stay pure.
    let assistantContent = "";
    const appendDelta = (delta: string): void => {
      assistantContent += delta;
      setMessages((prev) =>
        prev.map((message) => (message.id === assistant.id ? { ...message, content: assistantContent } : message)),
      );
    };

    // Idle watchdog: a turn that stalls mid-stream (no frames) is aborted so the UI
    // never wedges in `streaming`. `timedOut` distinguishes this from a user `stop`.
    const idleMs = streamTimeoutMs ?? DEFAULT_STREAM_TIMEOUT_MS;
    let timedOut = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const armWatchdog = (): void => {
      if (idleMs <= 0) return;
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, idleMs);
    };

    try {
      const response = await fetch(api, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream", ...headers },
        body: JSON.stringify({ message: content, ...body }),
        credentials: withCredentials ? "include" : "same-origin",
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`The chat request failed (${response.status}).`);
      }

      let reason: ChatFinishReason | null = null;
      let usage: ChatUsage | undefined;
      armWatchdog();
      await parseChatStream(response.body, (event) => {
        armWatchdog();
        switch (event.type) {
          case "start":
            setStatus("streaming");
            break;
          case "text-delta":
            setStatus("streaming");
            appendDelta(event.delta);
            break;
          case "finish":
            reason = event.reason;
            usage = event.usage;
            break;
          case "error":
            throw new Error(event.message);
        }
      });

      if (reason === null) throw new Error("The response ended before the turn finished.");

      setStatus("ready");
      setFinishReason(reason);
      onFinish?.({ message: { ...assistant, content: assistantContent }, reason, usage });
    } catch (caught) {
      if (controller.signal.aborted && !timedOut) {
        setStatus("ready");
        return;
      }
      const failure = timedOut
        ? new Error("The response timed out.")
        : caught instanceof Error
          ? caught
          : new Error("Unknown chat error");
      setError(failure);
      setStatus("error");
      onError?.(failure);
    } finally {
      if (watchdog) clearTimeout(watchdog);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, []);

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => setInput(event.target.value),
    [],
  );

  const handleSubmit = useCallback(
    (event?: { preventDefault?: () => void }): void => {
      event?.preventDefault?.();
      const text = input;
      setInput("");
      void sendMessage(text);
    },
    [input, sendMessage],
  );

  return {
    messages,
    input,
    setInput,
    handleInputChange,
    handleSubmit,
    sendMessage,
    status,
    finishReason,
    error,
    stop,
  };
}
