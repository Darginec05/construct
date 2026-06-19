import { describe, expect, it } from "vitest";
import {
  ChannelHandle,
  ResourceHandle,
  isChannel,
  isResource,
  toChannel,
  toExpr,
  toResource,
  tpl,
} from "../src/expr.js";

describe("ChannelHandle", () => {
  it("exposes read expressions via $ and path()", () => {
    const ch = new ChannelHandle("plan", "json", "lastValue");
    expect(ch.$).toBe("$.plan");
    expect(ch.path("tasks")).toBe("$.plan.tasks");
    expect(ch.toString()).toBe("{{plan}}");
    expect(ch.__kind).toBe("channel");
  });
});

describe("ResourceHandle", () => {
  it("stringifies to the resource name", () => {
    const r = new ResourceHandle("box", "sandbox", "session");
    expect(r.toString()).toBe("box");
    expect(r.__kind).toBe("resource");
    expect(r.kind).toBe("sandbox");
    expect(r.scope).toBe("session");
  });
});

describe("type guards", () => {
  it("isChannel and isResource discriminate handles", () => {
    const ch = new ChannelHandle("x", "text", "lastValue");
    const r = new ResourceHandle("y", "db", "run");
    expect(isChannel(ch)).toBe(true);
    expect(isChannel("x")).toBe(false);
    expect(isResource(r)).toBe(true);
    expect(isResource(ch)).toBe(false);
  });
});

describe("toExpr", () => {
  it("serializes handles, strings, and primitives", () => {
    const ch = new ChannelHandle("msg", "text", "lastValue");
    expect(toExpr(ch)).toBe("$.msg");
    expect(toExpr("raw")).toBe("raw");
    expect(toExpr(42)).toBe("42");
    expect(toExpr(true)).toBe("true");
  });
});

describe("toChannel / toResource", () => {
  it("accepts handles, bare names, and undefined", () => {
    const ch = new ChannelHandle("out", "json", "lastValue");
    const r = new ResourceHandle("db", "db", "run");
    expect(toChannel(ch)).toBe("out");
    expect(toChannel("out")).toBe("out");
    expect(toChannel(undefined)).toBeUndefined();
    expect(toResource(r)).toBe("db");
    expect(toResource("db")).toBe("db");
    expect(toResource(undefined)).toBeUndefined();
  });
});

describe("tpl", () => {
  it("interpolates channel handles as {{name}} tokens", () => {
    const a = new ChannelHandle("shot", "image", "lastValue");
    const b = new ChannelHandle("tokens", "json", "lastValue");
    expect(tpl`Critique ${a} against ${b}`).toBe("Critique {{shot}} against {{tokens}}");
  });

  it("stringifies non-channel values as-is", () => {
    const ch = new ChannelHandle("x", "text", "lastValue");
    expect(tpl`Score ${ch} is ${100}`).toBe("Score {{x}} is 100");
  });
});
