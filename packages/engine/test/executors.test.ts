import { describe, expect, it } from "vitest";
import { evaluate as evalExpr } from "../src/expr.js";
import {
  getExecutor,
  getFunction,
  registerExecutor,
  registerFunction,
} from "../src/executors.js";
import type { ExecutorContext, RunState } from "../src/types.js";

function makeCtx(
  config: Record<string, unknown>,
  state: RunState = {},
): ExecutorContext {
  return { config, state, evaluate: (expr) => evalExpr(expr, state) };
}

describe("executor registry", () => {
  it("round-trips a registered executor", () => {
    const fn = () => ({});
    registerExecutor("test-exec", fn);
    expect(getExecutor("test-exec")).toBe(fn);
  });

  it("returns undefined for an unregistered type", () => {
    expect(getExecutor("no-such-executor")).toBeUndefined();
  });

  it("round-trips a registered function", () => {
    const fn = () => 1;
    registerFunction("test-fn", fn);
    expect(getFunction("test-fn")).toBe(fn);
  });

  it("returns undefined for an unregistered function ref", () => {
    expect(getFunction("no-such-fn")).toBeUndefined();
  });
});

describe("built-in: transform", () => {
  it("evaluates expr and writes to the target channel", async () => {
    const exec = getExecutor("transform")!;
    const result = await exec(makeCtx({ expr: "$.x", writeTo: "out" }, { x: 5 }));
    expect(result).toEqual({ patch: { out: 5 } });
  });

  it("produces no patch when writeTo is absent", async () => {
    const exec = getExecutor("transform")!;
    const result = await exec(makeCtx({ expr: "$.x" }, { x: 5 }));
    expect(result).toEqual({});
  });
});

describe("built-in: code", () => {
  it("runs the referenced function and writes its result", async () => {
    registerFunction("double", (ctx) => Number(ctx.state.v) * 2);
    const exec = getExecutor("code")!;
    const result = await exec(makeCtx({ ref: "double", writeTo: "out" }, { v: 4 }));
    expect(result).toEqual({ patch: { out: 8 } });
  });

  it("produces no patch when writeTo is absent", async () => {
    registerFunction("noop", () => 1);
    const exec = getExecutor("code")!;
    expect(await exec(makeCtx({ ref: "noop" }))).toEqual({});
  });

  it("rejects inline source (non-string ref) in v1", async () => {
    const exec = getExecutor("code")!;
    await expect(exec(makeCtx({ inline: "return 1" }))).rejects.toThrow(
      /inline source is not supported/,
    );
  });

  it("throws when the ref is not registered", async () => {
    const exec = getExecutor("code")!;
    await expect(exec(makeCtx({ ref: "ghost" }))).rejects.toThrow(
      /no function registered for ref "ghost"/,
    );
  });
});
