/** Human-readable field labels for the inspector (presentation only). */

const OVERRIDES: Record<string, string> = {
  from: "Returns",
  on: "On (expression)",
  over: "Over (collection)",
  body: "Sub-flow body",
  flow: "Sub-flow",
  writeTo: "Write to channel",
  ttl: "TTL (seconds)",
  schema: "Input schema",
  ref: "Handler ref",
  inline: "Inline source",
  topK: "Top K",
  maxUsd: "Max USD",
  toolChoice: "Tool choice",
  maxSteps: "Max steps",
  maxIterations: "Max iterations",
  maxTokens: "Max tokens",
  requiresApproval: "Requires approval",
};

/** camelCase → "Camel case". */
function humanize(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function fieldLabel(key: string): string {
  return OVERRIDES[key] ?? humanize(key);
}

/** One-line help shared across nodes, keyed by field name. */
export const GENERIC_HINTS: Record<string, string> = {
  writeTo: "Save this node's result into a named state channel.",
  ttl: "How long the pending decision stays open, in seconds.",
  resource: "Bind the call to a declared resource session.",
  ref: "Id of a registered handler function.",
  budget: "Cost guardrail; leave a field blank to skip it.",
};

/** Placeholder for expression fields (the `$.channel` / `{{channel}}` convention). */
export const EXPR_PLACEHOLDER = "$.channel · {{channel}} · literal";
