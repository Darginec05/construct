import { resolveNodeOutputs } from "@construct/dsl";
import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { catalogEntry, CATEGORY_META } from "../lib/catalog.ts";

export interface ConstructNodeData {
  type: string;
  config: Record<string, unknown>;
  label?: string;
}

function ConstructNodeImpl({ data, selected }: NodeProps<ConstructNodeData>) {
  const entry = catalogEntry(data.type);
  const hueVar = entry ? CATEGORY_META[entry.category].hueVar : "--cat-io";
  const Icon = entry?.icon;
  const outputs = resolveNodeOutputs(data.type, data.config);

  return (
    <div
      className="w-[248px] overflow-hidden rounded-lg border bg-card shadow-md"
      style={{
        // @ts-expect-error custom property
        "--cat": `var(${hueVar})`,
        borderColor: selected ? "hsl(var(--cat))" : "hsl(var(--border))",
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
