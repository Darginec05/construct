import type { Edge } from "reactflow";
import type { FlowNode } from "../flow/flow-context.tsx";

function fmt(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v || "—";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return Object.keys(v as object).join(", ") || "{}";
  return String(v);
}

type Cfg = Record<string, unknown>;

/** Plain-English one-liner describing what a node does. */
export function summarize(type: string, config: Cfg): string {
  const c = config;
  switch (type) {
    case "input":
      return "Receives " + (fmt(c.schema) || "input");
    case "output":
      return "Returns " + fmt(c.from);
    case "agent": {
      const model = (c.model as Cfg | undefined)?.model ?? (c.model as Cfg | undefined)?.provider ?? "model";
      const bits: string[] = [String(model)];
      const tools = c.tools as unknown[] | undefined;
      if (tools?.length) bits.push(`${tools.length} tool${tools.length > 1 ? "s" : ""}`);
      bits.push(`up to ${(c.maxSteps as number) ?? 8} steps`);
      return bits.join(" · ");
    }
    case "classifier":
      return `Routes on ${(c.classes as unknown[] | undefined)?.length ?? 0} classes`;
    case "branch":
      return "If " + fmt(c.condition);
    case "switch":
      return "Switch on " + fmt(c.on);
    case "loop":
      return `Repeat until ${fmt(c.until ?? "done")} · max ${(c.maxIterations as number) ?? 5}`;
    case "map":
      return `For each ${fmt(c.over)} · ×${(c.concurrency as number) ?? 4} ${(c.aggregate as string) ?? "collect"}`;
    case "join":
      return `Wait for ${(c.mode as string) ?? "all"} branches`;
    case "code":
      return "Run " + (c.ref ? String(c.ref) : "inline fn");
    case "retrieve":
      return `Fetch ${(c.topK as number) ?? 5} from ${fmt(c.store)}`;
    case "transform":
      return "Compute " + fmt(c.expr);
    case "tool":
      return `${fmt(c.tool)} · ${(c.tier as string) ?? "read"}${c.requiresApproval ? " · needs approval" : ""}`;
    case "human":
      return String(c.mode ?? "pause") + (Array.isArray(c.exits) ? ` (${(c.exits as string[]).join(" / ")})` : "");
    case "subflow":
      return "Run flow " + fmt(c.flow);
    default:
      return "";
  }
}

export interface FlowOrder {
  order: string[];
  back: Set<string>;
  byId: Map<string, FlowNode>;
}

/** Topological order with back-edge detection (cycles do not break it). */
export function orderFlow(nodes: FlowNode[], edges: Edge[]): FlowOrder {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const adj = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const e of edges) adj.get(e.source)?.push(e.target);

  const color = new Map<string, 1 | 2>();
  const back = new Set<string>();
  const dfs = (u: string) => {
    color.set(u, 1);
    for (const v of adj.get(u) ?? []) {
      if (color.get(v) === 1) back.add(`${u}->${v}`);
      else if (!color.has(v)) dfs(v);
    }
    color.set(u, 2);
  };
  const start = (nodes.find((n) => n.data.type === "input") ?? nodes[0])?.id;
  if (start) dfs(start);
  for (const n of nodes) if (!color.has(n.id)) dfs(n.id);

  const indeg = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const fwd = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (!back.has(`${e.source}->${e.target}`)) {
      fwd.get(e.source)?.push(e.target);
      indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
    }
  }
  const q = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  const order: string[] = [];
  while (q.length) {
    const u = q.shift()!;
    order.push(u);
    for (const v of fwd.get(u) ?? []) {
      const d = (indeg.get(v) ?? 0) - 1;
      indeg.set(v, d);
      if (d === 0) q.push(v);
    }
  }
  const seen = new Set(order);
  for (const n of nodes) if (!seen.has(n.id)) order.push(n.id);
  return { order, back, byId };
}
