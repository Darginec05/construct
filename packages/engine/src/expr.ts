import type { RunState } from "./types.js";

/**
 * v1 expression evaluation. Intentionally tiny:
 * - `$.a.b`        → read a dotted path from state
 * - `"...{{x}}..."`→ interpolate `{{path}}` (or `{{$.path}}`) into a string
 * - a `{ k: expr }`→ a bundle; each value is evaluated
 * - anything else  → returned as a literal
 * No operators or function calls yet (that is a future expression language).
 */

export function getByPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc !==null && typeof acc === "object") {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

export function evaluate(expr: unknown, state: RunState): unknown {
  if (expr == null) return undefined;
  if (typeof expr === "string") return evalString(expr, state);
  if (Array.isArray(expr)) return expr.map((e) => evaluate(e, state));
  if (typeof expr === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(expr as Record<string, unknown>)) {
      out[k] = evaluate(v, state);
    }
    return out;
  }
  return expr;
}

function evalString(s: string, state: RunState): unknown {
  const trimmed = s.trim();
  if (trimmed.startsWith("$.")) {
    return getByPath(state, trimmed.slice(2));
  }
  if (s.includes("{{")) {
    return s.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, raw: string) => {
      const path = raw.startsWith("$.") ? raw.slice(2) : raw;
      const value = getByPath(state, path);
      if (value == null) return "";
      return typeof value === "string" ? value : JSON.stringify(value);
    });
  }
  return s;
}

export function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}
