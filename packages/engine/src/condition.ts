import { type Condition, type ConditionRule } from "@construct/dsl";
import { truthy } from "./expr.js";

/**
 * Evaluation of a structured {@link Condition} (the Branch node's `condition`).
 * The expression language stays tiny — `evaluate` only reads `$.x` leaves and
 * interpolates `{{tpl}}`. The comparison happens here, over already-evaluated
 * values, so no operators ever live inside the expression string.
 */

/** Evaluates a single DSL expression against the current run state. */
type Evaluate = (expr: unknown) => unknown;

/** Lift the back-compat bare-string form into a single `truthy` rule. */
function normalize(condition: unknown): Condition {
  if (typeof condition === "string") {
    return { combinator: "and", rules: [{ left: condition, op: "truthy" }] };
  }
  if (condition && typeof condition === "object" && Array.isArray((condition as Condition).rules)) {
    const c = condition as Condition;
    return { combinator: c.combinator ?? "and", rules: c.rules };
  }
  return { combinator: "and", rules: [] };
}

export function evalCondition(condition: unknown, evaluate: Evaluate): boolean {
  const { combinator, rules } = normalize(condition);
  // No rules → never take the true branch, rather than a silently-always-true split.
  if (rules.length === 0) return false;
  const results = rules.map((r) => evalRule(r, evaluate));
  return combinator === "or" ? results.some(Boolean) : results.every(Boolean);
}

function evalRule(rule: ConditionRule, evaluate: Evaluate): boolean {
  const left = evaluate(rule.left);
  switch (rule.op) {
    case "truthy":
      return truthy(left);
    case "falsy":
      return !truthy(left);
    case "empty":
      return isEmpty(left);
    case "notEmpty":
      return !isEmpty(left);
    default:
      break;
  }
  const right = rule.right === undefined ? undefined : evaluate(rule.right);
  switch (rule.op) {
    case "eq":
      return looseEquals(left, right);
    case "neq":
      return !looseEquals(left, right);
    case "gt":
      return numericCompare(left, right, (a, b) => a > b);
    case "gte":
      return numericCompare(left, right, (a, b) => a >= b);
    case "lt":
      return numericCompare(left, right, (a, b) => a < b);
    case "lte":
      return numericCompare(left, right, (a, b) => a <= b);
    case "contains":
      return containsValue(left, right);
    case "notContains":
      return !containsValue(left, right);
    default:
      return false;
  }
}

function isEmpty(value: unknown): boolean {
  if (value == null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Coerce to a finite number, or NaN when the value can't be a number. */
function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return Number.NaN;
}

/** Numeric when both sides are numeric, else a string compare — so `$.n == "5"`
 *  holds whether `n` is `5` or `"5"`. */
function looseEquals(a: unknown, b: unknown): boolean {
  const na = asNumber(a);
  const nb = asNumber(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb;
  return String(a ?? "") === String(b ?? "");
}

function numericCompare(
  a: unknown,
  b: unknown,
  cmp: (x: number, y: number) => boolean,
): boolean {
  const na = asNumber(a);
  const nb = asNumber(b);
  if (Number.isNaN(na) || Number.isNaN(nb)) return false;
  return cmp(na, nb);
}

function containsValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left)) return left.some((x) => looseEquals(x, right));
  if (typeof left === "string") return left.includes(String(right ?? ""));
  return false;
}
