import { Box, Workflow } from "lucide-react";
import type { FlowDoc } from "../flow/types.ts";
import { useWorkspace } from "../flow/workspace-context.tsx";

export function Flows() {
  const { flows, activeFlowId, setActiveFlowId } = useWorkspace();
  const mains = flows.filter((f) => f.kind === "main");

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-3">
        <div className="text-[13px] font-semibold">Flows</div>
        <div className="text-[11px] text-muted-foreground">{flows.length} flows · main + sub-flows</div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {mains.map((f) => {
          const subs = flows.filter((s) => s.parent === f.id);
          return (
            <div key={f.id} className="mb-1">
              <FlowRow flow={f} active={activeFlowId === f.id} onSelect={setActiveFlowId} />
              {subs.length > 0 ? (
                <div className="ml-3 border-l border-border pl-2">
                  {subs.map((s) => (
                    <FlowRow key={s.id} flow={s} active={activeFlowId === s.id} onSelect={setActiveFlowId} sub />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FlowRow({
  flow,
  active,
  onSelect,
  sub,
}: {
  flow: FlowDoc;
  active: boolean;
  onSelect: (id: string) => void;
  sub?: boolean;
}) {
  const Icon = sub ? Box : Workflow;
  const hue = sub ? "--cat-control" : "--cat-composite";
  return (
    <button
      type="button"
      onClick={() => onSelect(flow.id)}
      style={{ "--cat": `var(${hue})` } as React.CSSProperties}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${
        active ? "bg-accent" : "hover:bg-accent"
      }`}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--cat)/0.14)] text-[hsl(var(--cat))]">
        <Icon size={sub ? 12 : 13} />
      </span>
      <span className="flex-1 truncate text-[13px]">{flow.name}</span>
      <span className="text-[10px] text-muted-foreground">{sub ? "sub" : flow.nodes.length}</span>
    </button>
  );
}
