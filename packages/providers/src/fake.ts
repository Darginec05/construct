import type {
  ChatMessage,
  ChatOptions,
  ChatResult,
  ModelProvider,
} from "./index.js";

/**
 * What the fake returns for a single turn. Either a fixed {@link ChatResult} or
 * a function that derives one from the turn's messages and options — the latter
 * lets a test assert on what the runner sent (e.g. that a tool result was fed
 * back) before deciding how to reply.
 */
export type ScriptStep =
  | ChatResult
  | ((messages: ChatMessage[], opts: ChatOptions) => ChatResult);

/** A record of one `chat` invocation, kept so tests can assert on inputs. */
export interface FakeCall {
  messages: ChatMessage[];
  options: ChatOptions;
}

export interface FakeOptions {
  /** Provider id used in `model.provider`. Defaults to "fake". */
  id?: string;
  /**
   * Replies returned in order, one per `chat` call. A function step receives
   * the call's messages and options. Omit for a provider that always echoes.
   */
  script?: ScriptStep[];
}

/** A {@link ModelProvider} like {@link FakeProvider} but exposing its log. */
export interface FakeProvider extends ModelProvider {
  /** Every `chat` call in order, for assertions. */
  readonly calls: FakeCall[];
  /** Number of script steps consumed so far. */
  readonly cursor: number;
}

/**
 * A deterministic, offline {@link ModelProvider} for integration tests. It
 * replays a fixed script of replies and records every call, so a flow can be
 * driven through multi-turn tool loops without touching the network.
 *
 * When the script is exhausted (or none was given) it echoes the last user
 * message, which keeps single-turn happy-path tests short. When
 * {@link ChatOptions.onDelta} is set it streams the reply text in one chunk so
 * the same streaming code path is exercised.
 */
export function createFakeProvider(options: FakeOptions = {}): FakeProvider {
  const id = options.id ?? "fake";
  const script = options.script ?? [];
  const calls: FakeCall[] = [];
  let cursor = 0;

  return {
    id,
    get calls() {
      return calls;
    },
    get cursor() {
      return cursor;
    },
    async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
      calls.push({ messages, options: opts });

      const step = script[cursor];
      let result: ChatResult;
      if (step !== undefined) {
        cursor++;
        result = typeof step === "function" ? step(messages, opts) : step;
      } else {
        // No script left: echo the most recent user message.
        const lastUser = [...messages].reverse().find((m) => m.role === "user");
        result = { text: lastUser?.content ?? "", stopReason: "end_turn" };
      }

      if (opts.onDelta && result.text) opts.onDelta(result.text);
      return result;
    },
  };
}
