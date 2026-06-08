import { resolveNodeOutputs } from "@construct/dsl";
import { memo } from "react";
import { AlertTriangle } from "lucide-react";
import { Handle, Position, type NodeProps } from "reactflow";
import { catalogEntry, CATEGORY_META } from "../lib/catalog.ts";
import { useRun } from "./run-context.tsx";
import type { NodeRunState } from "./types.ts";
import { useValidation } from "./validation-context.tsx";

export interface ConstructNodeData {
  type: string;
  config: Record<string, unknown>;
  label?: string;
}

const RUN_RING: Record<NodeRunState, string> = {
  running: "hsl(var(--cat-control))",
  done: "hsl(var(--cat-tool))",
  error: "hsl(var(--destructive))",
};

function ConstructNodeImpl({ id, data, selected }: NodeProps<ConstructNodeData>) {
  const entry = catalogEntry(data.type);
  const hueVar = entry ? CATEGORY_META[entry.category].hueVar : "--cat-io";
  const Icon = entry?.icon;
  const outputs = resolveNodeOutputs(data.type, data.config);
  const { nodeRun } = useRun();
  const { issuesByNode } = useValidation();
  const status = nodeRun[id];
  const nodeIssues = issuesByNode[id] ?? [];
  const hasError = nodeIssues.some((i) => i.level === "error");
  const hasWarning = !hasError && nodeIssues.length > 0;
  const issueColor = hasError ? "hsl(var(--destructive))" : "hsl(var(--cat-control))";

  const borderColor = status
    ? RUN_RING[status]
    : selected
      ? "hsl(var(--cat))"
      : hasError || hasWarning
        ? issueColor
        : "hsl(var(--border))";

  return (
    <div
      className="w-[248px] overflow-hidden rounded-lg border bg-card shadow-md"
      style={{
        // @ts-expect-error custom property
        "--cat": `var(${hueVar})`,
        borderColor,
        boxShadow: status
          ? `0 0 0 2px ${RUN_RING[status]}`
          : !selected && (hasError || hasWarning)
            ? `0 0 0 1px ${issueColor}`
            : undefined,
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !border-2 !border-card !bg-[hsl(var(--cat))]"
      />

      <div className="flex items-center gap-2 border-b border-border bg-[hsl(var(--cat)/0.07)] px-3 py-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[hsl(var(--cat)/0.14)] text-[hsl(var(--cat))]">
          {Icon ? <Icon size={14} /> : null}
        </span>
        <span className="truncate text-[13px] font-medium">
          {data.label ?? entry?.label ?? data.type}
        </span>
        {status ? (
          <span
            className={`ml-auto h-2 w-2 shrink-0 rounded-full ${status === "running" ? "animate-pulse" : ""}`}
            style={{ background: RUN_RING[status] }}
            title={status}
          />
        ) : nodeIssues.length > 0 ? (
          <span
            className="ml-auto flex shrink-0 items-center"
            style={{ color: issueColor }}
            title={nodeIssues.map((i) => `${i.level}: ${i.message}`).join("\n")}
          >
            <AlertTriangle size={13} />
          </span>
        ) : null}
      </div>

      <div className="relative px-3 py-2 text-[11px] text-muted-foreground">
        {entry?.description ?? data.type}
      </div>

      {outputs.map((name, i) => (
        <Handle
          key={name}
          id={name}
          type="source"
          position={Position.Right}
          style={{ top: `calc(100% - 14px - ${i * 18}px)` }}
          className="!h-2.5 !w-2.5 !border-2 !border-card !bg-[hsl(var(--cat))]"
        />
      ))}
    </div>
  );
}

export const ConstructNode = memo(ConstructNodeImpl);
