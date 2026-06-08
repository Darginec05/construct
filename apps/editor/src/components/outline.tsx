import { catalogEntry, CATEGORY_META } from "../lib/catalog.ts";
import { useWorkspace } from "../flow/workspace-context.tsx";

export function Outline() {
  const { nodes, activeFlow, selectedId, setSelectedId } = useWorkspace();

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-3">
        <div className="text-[13px] font-semibold">Outline</div>
        <div className="text-[11px] text-muted-foreground">
          {nodes.length} nodes in {activeFlow.name}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {nodes.length === 0 ? (
          <div className="px-2 py-4 text-[12px] text-muted-foreground">Empty flow.</div>
        ) : (
          nodes.map((n) => {
            const entry = catalogEntry(n.data.type);
            const hueVar = entry ? CATEGORY_META[entry.category].hueVar : "--cat-io";
            const Icon = entry?.icon;
            const active = selectedId === n.id;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => setSelectedId(n.id)}
                style={{ "--cat": `var(${hueVar})` } as React.CSSProperties}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${
                  active ? "bg-accent" : "hover:bg-accent"
                }`}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--cat)/0.14)] text-[hsl(var(--cat))]">
                  {Icon ? <Icon size={13} /> : null}
                </span>
                <span className="flex-1 truncate text-[13px]">{entry?.label ?? n.data.type}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{n.data.type}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
