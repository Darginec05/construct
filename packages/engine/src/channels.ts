import type { Channel, Flow } from "@construct/dsl";
import type { RunState } from "./types.js";

/** Build channel defaults, then layer input and explicit initial state on top. */
export function initState(
  flow: Flow,
  input?: RunState,
  initialState?: RunState,
): RunState {
  const state: RunState = {};
  for (const ch of flow.channels) {
    state[ch.name] = ch.initial;
  }
  if (input) Object.assign(state, input);
  if (initialState) Object.assign(state, initialState);
  return state;
}

export function channelMap(flow: Flow): Map<string, Channel> {
  return new Map(flow.channels.map((c) => [c.name, c]));
}

/** Apply a patch, combining each write according to its channel's reducer. */
export function applyPatch(
  state: RunState,
  patch: Record<string, unknown>,
  channels: Map<string, Channel>,
): void {
  for (const [name, value] of Object.entries(patch)) {
    const reducer = channels.get(name)?.reducer ?? "lastValue";
    if (reducer === "append") {
      const cur = state[name];
      state[name] = Array.isArray(cur) ? [...cur, value] : [value];
    } else if (reducer === "merge") {
      const cur = state[name];
      state[name] =
        cur && typeof cur === "object"
          ? { ...(cur as object), ...(value as object) }
          : value;
    } else {
      state[name] = value;
    }
  }
}
