import { useMemo } from "react";
import { ChevronRight, Merge, Repeat } from "lucide-react";
import { catalogEntry, CATEGORY_META } from "../lib/catalog.ts";
import { orderFlow, summarize } from "../lib/order-flow.ts";
import { useWorkspace } from "../flow/workspace-context.tsx";

export function ReaderView() {
  const { nodes, edges, selectedId, setSelectedId, activeFlow } = useWorkspace();
  const { order, back, byId } = useMemo(() => orderFlow(nodes, edges), [nodes, edges]);

  return (
    <div className="h-full overflow-y-auto bg-canvas-bg">
      <div className="mx-auto max-w-2xl px-6 py-8">
        <div className="mb-6">
          <div className="text-lg font-semibold tracking-tight">{activeFlow.name}</div>
          <div className="text-[13px] text-muted-foreground">
            {nodes.length} steps · read top to bottom · {back.size} loop-back
            {back.size === 1 ? "" : "s"}
          </div>
        </div>

        {order.map((id, i) => {
          const node = byId.get(id);
          if (!node) return null;
          const entry = catalogEntry(node.data.type);
          const hueVar = entry ? CATEGORY_META[entry.category].hueVar : "--cat-io";
          const Icon = entry?.icon;
          const outs = edges.filter((e) => e.source === id);
          const ins = edges.filter((e) => e.target === id && !back.has(`${e.source}->${e.target}`));
          const selected = selectedId === id;

          return (
            <div key={id} className="flex gap-3" style={{ "--cat": `var(${hueVar})` } as React.CSSProperties}>
              <div className="flex flex-col items-center">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--cat))] text-[12px] font-semibold text-white">
                  {i + 1}
                </div>
                {i < order.length - 1 ? <div className="my-1 w-px flex-1 bg-border" /> : null}
              </div>

              <button
                type="button"
                onClick={() => setSelectedId(id)}
                className={`mb-3 flex-1 rounded-lg border bg-card p-3 text-left shadow-sm transition ${
                  selected ? "border-[hsl(var(--cat))]" : "border-border"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[hsl(var(--cat)/0.14)] text-[hsl(var(--cat))]">
                    {Icon ? <Icon size={13} /> : null}
                  </span>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {entry ? CATEGORY_META[entry.category].label : node.data.type}
                    </div>
                    <div className="text-[13px] font-medium">{entry?.label ?? node.data.type}</div>
                  </div>
                </div>

                <div className="mt-2 text-[12px] text-muted-foreground">
                  {summarize(node.data.type, node.data.config)}
                </div>

                {ins.length > 1 ? (
                  <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Merge size={12} /> joins from{" "}
                    {ins.map((e) => byId.get(e.source)?.data && (catalogEntry(byId.get(e.source)!.data.type)?.label)).filter(Boolean).join(", ")}
                  </div>
                ) : null}

                {outs.length > 0 ? (
                  <div className="mt-2 space-y-1">
                    {outs.map((e, j) => {
                      const isBack = back.has(`${e.source}->${e.target}`);
                      const tgt = byId.get(e.target);
                      const tgtLabel = tgt ? catalogEntry(tgt.data.type)?.label ?? tgt.data.type : e.target;
                      const handle = e.sourceHandle && e.sourceHandle !== "out" ? e.sourceHandle : null;
                      return (
                        <div key={j} className="flex items-center gap-1.5 text-[12px]">
                          {isBack ? (
                            <Repeat size={13} className="text-[hsl(var(--cat-control))]" />
                          ) : (
                            <ChevronRight size={13} className="text-muted-foreground" />
                          )}
                          {handle ? (
                            <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {handle}
                            </span>
                          ) : null}
                          <span
                            role="link"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              setSelectedId(e.target);
                            }}
                            className="cursor-pointer font-medium hover:underline"
                          >
                            {tgtLabel}
                          </span>
                          {isBack ? <span className="text-[11px] text-muted-foreground">(loops back)</span> : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
