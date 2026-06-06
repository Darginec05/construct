import type { Flow, FlowNode } from "./flow.js";
import { getNodeSpec, resolveNodeOutputs } from "./nodes.js";

/**
 * Semantic validation, layered on top of the structural `parseFlow`. It checks
 * each node's config against the catalog, that edges connect real nodes and
 * valid handles, and that channel / resource references resolve.
 */

export interface ValidationIssue {
  level: "error" | "warning";
  message: string;
  nodeId?: string;
  edgeId?: string;
}

/** Fields that, by convention, name the channel a node writes its result to. */
function writeTargetOf(node: FlowNode): string | undefined {
  const w = (node.config as Record<string, unknown>).writeTo;
  return typeof w === "string" ? w : undefined;
}

export function validateFlow(flow: Flow): ValidationIssue[] {
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

  const channelNames = new Set(flow.channels.map((c) => c.name));
  const resourceNames = new Set(flow.resources.map((r) => r.name));

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

    const writeTo = writeTargetOf(node);
    if (writeTo && !channelNames.has(writeTo)) {
      issues.push({
        level: "error",
        nodeId: node.id,
        message: `writes to undeclared channel "${writeTo}"`,
      });
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
export function assertValidFlow(flow: Flow): void {
  const errors = validateFlow(flow).filter((i) => i.level === "error");
  if (errors.length > 0) {
    const lines = errors.map(
      (e) => `  - ${e.nodeId ?? e.edgeId ?? "flow"}: ${e.message}`,
    );
    throw new Error(`invalid flow:\n${lines.join("\n")}`);
  }
}
