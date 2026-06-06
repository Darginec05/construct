import type { Channel, Flow } from "@construct/dsl";
import { describe, expect, it } from "vitest";
import { applyPatch, channelMap, initState } from "../src/channels.js";

function flowWith(channels: Channel[]): Flow {
  return { channels } as Flow;
}

function ch(name: string, reducer: Channel["reducer"] = "lastValue"): Channel {
  return { name, type: "any", reducer } as Channel;
}

describe("initState", () => {
  it("seeds channel defaults from initial", () => {
    const state = initState(
      flowWith([
        { name: "n", type: "json", reducer: "lastValue", initial: 0 } as Channel,
        { name: "log", type: "text", reducer: "append", initial: [] } as Channel,
      ]),
    );
    expect(state).toEqual({ n: 0, log: [] });
  });

  it("leaves channels without an initial as undefined", () => {
    const state = initState(flowWith([ch("x")]));
    expect("x" in state).toBe(true);
    expect(state.x).toBeUndefined();
  });

  it("layers input on top of channel defaults", () => {
    const state = initState(
      flowWith([{ name: "n", type: "json", reducer: "lastValue", initial: 0 } as Channel]),
      { n: 5 },
    );
    expect(state.n).toBe(5);
  });

  it("layers initialState on top of input", () => {
    const state = initState(
      flowWith([{ name: "n", type: "json", reducer: "lastValue", initial: 0 } as Channel]),
      { n: 5 },
      { n: 9 },
    );
    expect(state.n).toBe(9);
  });
});

describe("channelMap", () => {
  it("indexes channels by name", () => {
    const a = ch("a");
    const b = ch("b");
    const map = channelMap(flowWith([a, b]));
    expect(map.get("a")).toBe(a);
    expect(map.get("b")).toBe(b);
    expect(map.get("missing")).toBeUndefined();
  });
});

describe("applyPatch", () => {
  const channels = new Map<string, Channel>([
    ["last", ch("last", "lastValue")],
    ["log", ch("log", "append")],
    ["bag", ch("bag", "merge")],
  ]);

  it("overwrites with lastValue", () => {
    const state: Record<string, unknown> = { last: "old" };
    applyPatch(state, { last: "new" }, channels);
    expect(state.last).toBe("new");
  });

  it("appends to an existing array", () => {
    const state: Record<string, unknown> = { log: ["a"] };
    applyPatch(state, { log: "b" }, channels);
    expect(state.log).toEqual(["a", "b"]);
  });

  it("starts a fresh array when appending to a non-array", () => {
    const state: Record<string, unknown> = {};
    applyPatch(state, { log: "first" }, channels);
    expect(state.log).toEqual(["first"]);
  });

  it("shallow-merges objects", () => {
    const state: Record<string, unknown> = { bag: { a: 1 } };
    applyPatch(state, { bag: { b: 2 } }, channels);
    expect(state.bag).toEqual({ a: 1, b: 2 });
  });

  it("replaces a non-object when merging", () => {
    const state: Record<string, unknown> = { bag: "scalar" };
    applyPatch(state, { bag: { b: 2 } }, channels);
    expect(state.bag).toEqual({ b: 2 });
  });

  it("defaults to lastValue for an undeclared channel", () => {
    const state: Record<string, unknown> = {};
    applyPatch(state, { ghost: 1 }, channels);
    expect(state.ghost).toBe(1);
  });

  it("applies several writes in one patch", () => {
    const state: Record<string, unknown> = { log: [] };
    applyPatch(state, { last: 1, log: "x" }, channels);
    expect(state).toEqual({ last: 1, log: ["x"] });
  });
});
