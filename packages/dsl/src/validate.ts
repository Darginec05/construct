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

/**
 * Whether an agent `system`/`prompt` source carries content: a non-empty inline
 * template, a registry {@link PromptRef} (object with a `ref`), or an array with
 * at least one such part.
 */
function hasPromptSource(value: unknown): boolean {
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.some(hasPromptSource);
  if (value && typeof value === "object") {
    const ref = (value as Record<string, unknown>).ref;
    return typeof ref === "string" && ref.trim() !== "";
  }
  return false;
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
      const hasPrompt = hasPromptSource(cfg.prompt);
      const hasSystem = hasPromptSource(cfg.system);
      if (!hasPrompt && !hasSystem) {
        issues.push({
          level: "warning",
          nodeId: node.id,
          message: `agent has neither a prompt nor a system message — it will call the model with empty input`,
        });
      }
    }

    if (node.type === "human") {
      const cfg = node.config as Record<string, unknown>;
      // Custom exits become this node's output handles; a blank or duplicate
      // name silently breaks edge-handle resolution downstream.
      if (Array.isArray(cfg.exits)) {
        const seen = new Set<string>();
        for (const exit of cfg.exits) {
          if (typeof exit !== "string" || exit.trim() === "") {
            issues.push({
              level: "error",
              nodeId: node.id,
              message: `human exit names must be non-empty`,
            });
          } else if (seen.has(exit)) {
            issues.push({
              level: "error",
              nodeId: node.id,
              message: `duplicate human exit "${exit}"`,
            });
          } else {
            seen.add(exit);
          }
        }
      }
      // collect/annotate capture a reply; without writeTo it goes nowhere.
      // approve/select capture no value, so a writeTo there never fills.
      const capturesText = cfg.mode === "collect" || cfg.mode === "annotate";
      const hasWriteTo = typeof cfg.writeTo === "string" && cfg.writeTo.trim() !== "";
      if (capturesText && !hasWriteTo) {
        issues.push({
          level: "warning",
          nodeId: node.id,
          message: `${String(cfg.mode)} captures a reply but has no writeTo — the input is discarded`,
        });
      } else if (!capturesText && cfg.mode !== undefined && hasWriteTo) {
        issues.push({
          level: "warning",
          nodeId: node.id,
          message: `${String(cfg.mode)} captures no value — writeTo "${String(cfg.writeTo)}" will stay empty`,
        });
      }
    }

    if (node.type === "branch") {
      const cond = (node.config as Record<string, unknown>).condition;
      const isEmpty =
        cond == null ||
        (typeof cond === "string" && cond.trim() === "") ||
        (typeof cond === "object" &&
          Array.isArray((cond as { rules?: unknown }).rules) &&
          (cond as { rules: unknown[] }).rules.length === 0);
      if (isEmpty) {
        issues.push({
          level: "warning",
          nodeId: node.id,
          message: `branch has no conditions — it will always take the false path`,
        });
      }
    }

    if (node.type === "switch") {
      const cases = (node.config as Record<string, unknown>).cases;
      if (Array.isArray(cases)) {
        // Each case label becomes an output handle; a blank, duplicate, or
        // "default" label silently collides with another handle or the
        // synthetic catch-all and breaks edge resolution downstream.
        const seen = new Set<string>();
        for (const c of cases) {
          const label = typeof c === "string" ? c : (c as { label?: unknown }).label;
          if (typeof label !== "string" || label.trim() === "") {
            issues.push({
              level: "error",
              nodeId: node.id,
              message: `switch case labels must be non-empty`,
            });
          } else if (label === "default") {
            issues.push({
              level: "error",
              nodeId: node.id,
              message: `switch case label "default" is reserved for the catch-all handle`,
            });
          } else if (seen.has(label)) {
            issues.push({
              level: "error",
              nodeId: node.id,
              message: `duplicate switch case "${label}"`,
            });
          } else {
            seen.add(label);
          }
        }
      }
    }

    if (node.type === "router") {
      const cfg = node.config as Record<string, unknown>;
      // A router with no prompt classifies an empty string — it will pick a
      // branch on no signal at all.
      if (!hasPromptSource(cfg.prompt)) {
        issues.push({
          level: "warning",
          nodeId: node.id,
          message: `router has no prompt — it will classify empty input`,
        });
      }
      // Class descriptions are what the model actually reads to decide; a bare
      // name gives it almost nothing to route on.
      const classes = Array.isArray(cfg.classes) ? cfg.classes : [];
      const undescribed = classes
        .filter(
          (c): c is { name: string } =>
            Boolean(c) &&
            typeof c === "object" &&
            typeof (c as { name?: unknown }).name === "string" &&
            !hasPromptSource((c as { description?: unknown }).description),
        )
        .map((c) => c.name);
      if (undescribed.length > 0) {
        issues.push({
          level: "warning",
          nodeId: node.id,
          message: `router routes have no description (${undescribed.join(", ")}) — the model only sees the name to decide`,
        });
      }
    }

    if (node.type === "output") {
      // `from` is the run's result: a single expression, or a named bundle
      // `{ key: expr }`. An empty source (or empty field) means the run returns
      // nothing/an empty slot — almost always a mistake.
      const from = (node.config as Record<string, unknown>).from;
      if (typeof from === "string") {
        if (from.trim() === "") {
          issues.push({
            level: "warning",
            nodeId: node.id,
            message: `output has no source — the run will return nothing`,
          });
        }
      } else if (from && typeof from === "object" && !Array.isArray(from)) {
        const entries = Object.entries(from as Record<string, unknown>);
        if (entries.length === 0) {
          issues.push({
            level: "warning",
            nodeId: node.id,
            message: `output bundle has no fields — the run will return an empty object`,
          });
        }
        for (const [key, expr] of entries) {
          if (key.trim() === "") {
            issues.push({
              level: "error",
              nodeId: node.id,
              message: `output bundle has an empty key`,
            });
          }
          if (typeof expr === "string" && expr.trim() === "") {
            issues.push({
              level: "warning",
              nodeId: node.id,
              message: `output field "${key}" has no source — it will be empty`,
            });
          }
        }
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

  // Splitting nodes (router/branch/switch) whose handles have no outgoing edge
  // are dead ends: the node can pick a path the run can't follow. Warn per
  // uncovered handle.
  const handlesBySource = new Map<string, Set<string>>();
  for (const edge of flow.edges) {
    if (!edge.sourceHandle) continue;
    const set = handlesBySource.get(edge.source);
    if (set) set.add(edge.sourceHandle);
    else handlesBySource.set(edge.source, new Set([edge.sourceHandle]));
  }
  for (const node of flow.nodes) {
    if (node.type !== "router" && node.type !== "branch" && node.type !== "switch") continue;
    const connected = handlesBySource.get(node.id) ?? new Set<string>();
    const unwired = resolveNodeOutputs(node.type, node.config).filter((h) => !connected.has(h));
    if (unwired.length > 0) {
      issues.push({
        level: "warning",
        nodeId: node.id,
        message: `${node.type} has output handles with no outgoing edge (${unwired.join(
          ", ",
        )}) — a path here is a dead end`,
      });
    }
  }

  const inputNodes = flow.nodes.filter((n) => n.type === "input");
  const hasOutput = flow.nodes.some((n) => n.type === "output");
  if (inputNodes.length === 0) {
    issues.push({ level: "warning", message: "flow has no input node" });
  }
  // The engine seeds the run payload into every input node, so more than one
  // makes the entry contract ambiguous. A flow has a single entry point.
  if (inputNodes.length > 1) {
    for (const node of inputNodes.slice(1)) {
      issues.push({
        level: "error",
        nodeId: node.id,
        message: "a flow may declare only one input node",
      });
    }
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
