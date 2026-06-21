import { useMemo, useState } from "react";
import {
  CATALOG,
  CATEGORY_META,
  CATEGORY_ORDER,
  type CatalogEntry,
} from "../lib/catalog.ts";
import { Input } from "./ui/input.tsx";

export const DND_TYPE = "application/construct-node";

function onDragStart(e: React.DragEvent, type: string) {
  e.dataTransfer.setData(DND_TYPE, type);
  e.dataTransfer.effectAllowed = "move";
}

export function NodeLibrary() {
  const [q, setQ] = useState("");

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const match = (e: CatalogEntry) =>
      !needle ||
      e.label.toLowerCase().includes(needle) ||
      e.type.includes(needle) ||
      e.description.toLowerCase().includes(needle);
    return CATEGORY_ORDER.map((cat) => ({
      cat,
      entries: CATALOG.filter((e) => e.category === cat && match(e)),
    })).filter((g) => g.entries.length > 0);
  }, [q]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-3">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search nodes…"
        />
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {groups.map((g) => (
          <div key={g.cat} className="mb-3">
            <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {CATEGORY_META[g.cat].label}
            </div>
            {g.entries.map((e) => {
              const Icon = e.icon;
              if (e.comingSoon) {
                return (
                  <div
                    key={e.type}
                    aria-disabled
                    title="Coming soon"
                    style={{ "--cat": `var(${CATEGORY_META[e.category].hueVar})` } as React.CSSProperties}
                    className="flex cursor-not-allowed items-center gap-2.5 rounded-md px-2 py-1.5 opacity-50"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--cat)/0.14)] text-[hsl(var(--cat))]">
                      <Icon size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{e.label}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{e.description}</div>
                    </div>
                    <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Soon
                    </span>
                  </div>
                );
              }
              return (
                <div
                  key={e.type}
                  draggable
                  onDragStart={(ev) => onDragStart(ev, e.type)}
                  style={{ "--cat": `var(${CATEGORY_META[e.category].hueVar})` } as React.CSSProperties}
                  className="flex cursor-grab items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent active:cursor-grabbing"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--cat)/0.14)] text-[hsl(var(--cat))]">
                    <Icon size={15} />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium">{e.label}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{e.description}</div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
