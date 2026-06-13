import type { Flow } from "./flow.js";
import { getNodeSpec, resolveNodeOutputs } from "./nodes.js";
import { flowVariableNames } from "./variables.js";
import { expressionRefs } from "./expr-tokens.js";

/**
 * Semantic validation, layered on top of the structural `parseFlow`. It checks
 * each node's config against the catalog, that edges connect real nodes and
 * valid handles, that resource references resolve, and that every `$.x` /
 * `{{x}}` reference names a variable the flow actually exposes.
 */

export interface ValidationIssue {
  level: "error" | "warning";
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface ValidateOptions {
  /**
   * Variable names seeded from the enclosing context, beyond the flow's own
   * registry — e.g. `["item", "index"]` when validating a loop/map body.
   */
  scopeVariables?: string[];
}

/** Collect the root variable names referenced by any expression in a value tree. */
function collectRefs(value: unknown, into: Set<string>): void {
  if (typeof value === "string") {
    for (const ref of expressionRefs(value)) into.add(ref);
  } else if (Array.isArray(value)) {
    for (const v of value) collectRefs(v, into);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectRefs(v, into);
  }
}

export function validateFlow(flow: Flow, opts: ValidateOptions = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const nodeIds = new Set<string>();
  for (const node of flow.nodes) {
    if (nodeIds.has(node.id)) {
      issues.push({
        level: "error",
        nodeId: node.id,
        message: `duplicate node id "${node.id}"`,
      });
    }
    nodeIds.add(node.id);
  }

  const resourceNames = new Set(flow.resources.map((r) => r.name));
  // Every name the flow exposes (input fields ∪ channels ∪ writeTo producers),
  // plus any seeded by the caller (loop/map body bindings).
  const knownVars = flowVariableNames(flow);
  for (const name of opts.scopeVariables ?? []) knownVars.add(name);

  // Per-node: catalog config validation + reference checks.
  for (const node of flow.nodes) {
    const spec = getNodeSpec(node.type);
    if (!spec) {
      issues.push({
        level: "warning",
        nodeId: node.id,
        message: `unknown node type "${node.type}" (no catalog spec; assuming plugin)`,
      });
      continue;
    }

    const parsed = spec.configSchema.safeParse(node.config);
    if (!parsed.success) {
      for (const err of parsed.error.errors) {
        const path = err.path.join(".");
        issues.push({
          level: "error",
          nodeId: node.id,
          message: `config${path ? `.${path}` : ""}: ${err.message}`,
        });
      }
    }

    // A `writeTo` no longer needs a pre-declared channel — it defines a
    // variable. But every *read* (`$.x` / `{{x}}`) must resolve to a known one.
    const refs = new Set<string>();
    collectRefs(node.config, refs);
    for (const ref of refs) {
      if (!knownVars.has(ref)) {
        issues.push({
          level: "warning",
          nodeId: node.id,
          message: `references unknown variable "${ref}"`,
        });
      }
    }

    if (node.type === "tool") {
      const resource = (node.config as Record<string, unknown>).resource;
      if (typeof resource === "string" && !resourceNames.has(resource)) {
        issues.push({
          level: "error",
          nodeId: node.id,
          message: `binds to undeclared resource "${resource}"`,
        });
      }
    }

    if (node.type === "join") {
      const cfg = node.config as Record<string, unknown>;
      if (cfg.mode === "quorum" && typeof cfg.count !== "number") {
        issues.push({
          level: "error",
          nodeId: node.id,
          message: `quorum join requires a numeric "count"`,
        });
      }
    }

    if (node.type === "agent") {
      const cfg = node.config as Record<string, unknown>;
      const hasPrompt = typeof cfg.prompt === "string" && cfg.prompt.trim() !== "";
      const hasSystem = typeof cfg.system === "string" && cfg.system.trim() !== "";
      if (!hasPrompt && !hasSystem) {
        issues.push({
          level: "warning",
          nodeId: node.id,
          message: `agent has neither a prompt nor a system message — it will call the model with empty input`,
        });
      }
    }
  }

  // Edges: endpoints exist; source handle is valid for the source node.
  for (const edge of flow.edges) {
    if (!nodeIds.has(edge.source)) {
      issues.push({
        level: "error",
        edgeId: edge.id,
        message: `edge source "${edge.source}" is not a node`,
      });
    }
    if (!nodeIds.has(edge.target)) {
      issues.push({
        level: "error",
        edgeId: edge.id,
        message: `edge target "${edge.target}" is not a node`,
      });
    }

    if (edge.sourceHandle) {
      const source = flow.nodes.find((n) => n.id === edge.source);
      if (source) {
        const handles = resolveNodeOutputs(source.type, source.config);
        if (handles.length > 0 && !handles.includes(edge.sourceHandle)) {
          issues.push({
            level: "error",
            edgeId: edge.id,
            message: `source handle "${edge.sourceHandle}" not in [${handles.join(
              ", ",
            )}] for node "${edge.source}"`,
          });
        }
      }
    }
  }

  const hasInput = flow.nodes.some((n) => n.type === "input");
  const hasOutput = flow.nodes.some((n) => n.type === "output");
  if (!hasInput) {
    issues.push({ level: "warning", message: "flow has no input node" });
  }
  if (!hasOutput) {
    issues.push({ level: "warning", message: "flow has no output node" });
  }

  return issues;
}

/** Parse-and-validate convenience: throws if there are any error-level issues. */
export function assertValidFlow(flow: Flow, opts: ValidateOptions = {}): void {
  const errors = validateFlow(flow, opts).filter((i) => i.level === "error");
  if (errors.length > 0) {
    const lines = errors.map(
      (e) => `  - ${e.nodeId ?? e.edgeId ?? "flow"}: ${e.message}`,
    );
    throw new Error(`invalid flow:\n${lines.join("\n")}`);
  }
}
