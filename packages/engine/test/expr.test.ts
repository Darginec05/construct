import { describe, expect, it } from "vitest";
import { evaluate, getByPath, truthy } from "../src/expr.js";

describe("getByPath", () => {
  const obj = { a: { b: { c: 42 } }, list: [1, 2] };

  it("reads a nested dotted path", () => {
    expect(getByPath(obj, "a.b.c")).toBe(42);
  });

  it("reads a top-level key", () => {
    expect(getByPath(obj, "a")).toEqual({ b: { c: 42 } });
  });

  it("returns undefined for a missing path", () => {
    expect(getByPath(obj, "a.x.y")).toBeUndefined();
  });

  it("returns undefined when descending through a non-object", () => {
    expect(getByPath(obj, "a.b.c.d")).toBeUndefined();
  });
});

describe("evaluate", () => {
  const state = {
    name: "Ada",
    count: 3,
    user: { id: 7 },
    items: [10, 20],
  };

  it("returns undefined for null/undefined", () => {
    expect(evaluate(null, state)).toBeUndefined();
    expect(evaluate(undefined, state)).toBeUndefined();
  });

  it("resolves a $.path string to the raw value", () => {
    expect(evaluate("$.user.id", state)).toBe(7);
    expect(evaluate("$.items", state)).toEqual([10, 20]);
  });

  it("returns a plain string unchanged", () => {
    expect(evaluate("hello world", state)).toBe("hello world");
  });

  it("interpolates {{path}} into a string", () => {
    expect(evaluate("Hi {{name}}!", state)).toBe("Hi Ada!");
    expect(evaluate("Hi {{$.name}}!", state)).toBe("Hi Ada!");
  });

  it("JSON-stringifies non-string values during interpolation", () => {
    expect(evaluate("u={{user}}", state)).toBe('u={"id":7}');
  });

  it("renders missing interpolation values as empty string", () => {
    expect(evaluate("x={{nope}}", state)).toBe("x=");
  });

  it("evaluates each element of an array", () => {
    expect(evaluate(["$.name", "lit", "$.count"], state)).toEqual([
      "Ada",
      "lit",
      3,
    ]);
  });

  it("evaluates each value of an object bundle", () => {
    expect(evaluate({ who: "$.name", id: "$.user.id" }, state)).toEqual({
      who: "Ada",
      id: 7,
    });
  });

  it("returns non-string literals as-is", () => {
    expect(evaluate(42, state)).toBe(42);
    expect(evaluate(true, state)).toBe(true);
  });
});

describe("truthy", () => {
  it("treats a non-empty array as true and empty as false", () => {
    expect(truthy([1])).toBe(true);
    expect(truthy([])).toBe(false);
  });

  it("falls back to Boolean for non-arrays", () => {
    expect(truthy("x")).toBe(true);
    expect(truthy("")).toBe(false);
    expect(truthy(0)).toBe(false);
    expect(truthy(1)).toBe(true);
    expect(truthy(null)).toBe(false);
    expect(truthy({})).toBe(true);
  });
});
