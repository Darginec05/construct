import type { Condition } from "@construct/dsl";
import { describe, expect, it } from "vitest";
import { evalCondition } from "../src/condition.js";
import { evaluate } from "../src/expr.js";
import type { RunState } from "../src/types.js";

/**
 * The Branch node's structured condition. Operators live here, not in the
 * expression string: `evaluate` only reads `$.x` leaves, `evalCondition`
 * compares them. These tests drive it against a real state via `evaluate`.
 */

const state: RunState = {
  count: 3,
  countStr: "3",
  status: "open",
  approved: true,
  flag: "false",
  items: [10, 20],
  empty: "",
  list: [],
};

function check(condition: Condition | string): boolean {
  return evalCondition(condition, (e) => evaluate(e, state));
}

describe("evalCondition operators", () => {
  it("eq compares numbers across string/number forms", () => {
    expect(check({ combinator: "and", rules: [{ left: "$.count", op: "eq", right: "3" }] })).toBe(true);
    expect(check({ combinator: "and", rules: [{ left: "$.countStr", op: "eq", right: "3" }] })).toBe(true);
    expect(check({ combinator: "and", rules: [{ left: "$.count", op: "eq", right: "4" }] })).toBe(false);
  });

  it("neq is the negation of eq", () => {
    expect(check({ combinator: "and", rules: [{ left: "$.status", op: "neq", right: "closed" }] })).toBe(true);
  });

  it("numeric comparisons coerce strings, fail on non-numbers", () => {
    expect(check({ combinator: "and", rules: [{ left: "$.count", op: "gt", right: "2" }] })).toBe(true);
    expect(check({ combinator: "and", rules: [{ left: "$.countStr", op: "gte", right: "3" }] })).toBe(true);
    expect(check({ combinator: "and", rules: [{ left: "$.count", op: "lt", right: "2" }] })).toBe(false);
    expect(check({ combinator: "and", rules: [{ left: "$.status", op: "gt", right: "1" }] })).toBe(false);
  });

  it("contains works for arrays and strings", () => {
    expect(check({ combinator: "and", rules: [{ left: "$.items", op: "contains", right: "10" }] })).toBe(true);
    expect(check({ combinator: "and", rules: [{ left: "$.status", op: "contains", right: "pen" }] })).toBe(true);
    expect(check({ combinator: "and", rules: [{ left: "$.items", op: "notContains", right: "99" }] })).toBe(true);
  });

  it("empty / notEmpty test presence", () => {
    expect(check({ combinator: "and", rules: [{ left: "$.empty", op: "empty" }] })).toBe(true);
    expect(check({ combinator: "and", rules: [{ left: "$.list", op: "empty" }] })).toBe(true);
    expect(check({ combinator: "and", rules: [{ left: "$.status", op: "notEmpty" }] })).toBe(true);
  });

  it("truthy / falsy reuse engine truthiness", () => {
    expect(check({ combinator: "and", rules: [{ left: "$.approved", op: "truthy" }] })).toBe(true);
    expect(check({ combinator: "and", rules: [{ left: "$.list", op: "falsy" }] })).toBe(true);
    // A non-empty string is truthy even if it reads "false" — a known footgun
    // the operators above let authors avoid (use `eq "true"` instead).
    expect(check({ combinator: "and", rules: [{ left: "$.flag", op: "truthy" }] })).toBe(true);
  });
});

describe("evalCondition edge cases", () => {
  it("eq compares booleans against their string form", () => {
    expect(check({ combinator: "and", rules: [{ left: "$.approved", op: "eq", right: "true" }] })).toBe(true);
    expect(check({ combinator: "and", rules: [{ left: "$.approved", op: "neq", right: "false" }] })).toBe(true);
  });

  it("gte / lte hold at the boundary", () => {
    expect(check({ combinator: "and", rules: [{ left: "$.count", op: "gte", right: "3" }] })).toBe(true);
    expect(check({ combinator: "and", rules: [{ left: "$.count", op: "lte", right: "3" }] })).toBe(true);
  });

  it("numeric ops on a missing variable are false, not a throw", () => {
    expect(check({ combinator: "and", rules: [{ left: "$.missing", op: "gt", right: "0" }] })).toBe(false);
  });

  it("contains on a missing / non-collection value is false", () => {
    expect(check({ combinator: "and", rules: [{ left: "$.missing", op: "contains", right: "x" }] })).toBe(false);
    expect(check({ combinator: "and", rules: [{ left: "$.count", op: "contains", right: "3" }] })).toBe(false);
  });

  it("notContains is true for a substring that is absent", () => {
    expect(check({ combinator: "and", rules: [{ left: "$.status", op: "notContains", right: "xyz" }] })).toBe(true);
  });

  it("a binary op missing its right side compares against undefined", () => {
    // right omitted → evaluate(undefined) → undefined; `open` !== "" so false.
    expect(check({ combinator: "and", rules: [{ left: "$.status", op: "eq" }] })).toBe(false);
    expect(check({ combinator: "and", rules: [{ left: "$.empty", op: "eq" }] })).toBe(true);
  });
});

describe("evalCondition combinators", () => {
  const a = { left: "$.count", op: "gt", right: "2" } as const;
  const b = { left: "$.status", op: "eq", right: "closed" } as const;

  it("and requires every rule", () => {
    expect(check({ combinator: "and", rules: [a, b] })).toBe(false);
    expect(check({ combinator: "and", rules: [a] })).toBe(true);
  });

  it("or requires any rule", () => {
    expect(check({ combinator: "or", rules: [a, b] })).toBe(true);
    expect(check({ combinator: "or", rules: [b] })).toBe(false);
  });

  it("no rules is false, never a silent always-true", () => {
    expect(check({ combinator: "and", rules: [] })).toBe(false);
    expect(check({ combinator: "or", rules: [] })).toBe(false);
  });
});

describe("evalCondition back-compat", () => {
  it("lifts a bare expression string into a single truthy rule", () => {
    expect(check("$.approved")).toBe(true);
    expect(check("$.list")).toBe(false);
  });
});
