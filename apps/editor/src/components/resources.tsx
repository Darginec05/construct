import { useMemo } from "react";
import { Cpu, Database, KeyRound, Wrench, type LucideIcon } from "lucide-react";
import type { FlowNode } from "../flow/types.ts";
import { useWorkspace } from "../flow/workspace-context.tsx";

interface ResItem {
  key: string;
  title: string;
  sub: string;
}

function derive(nodes: FlowNode[]) {
  const models = new Map<string, ResItem>();
  const tools = new Map<string, ResItem>();
  const stores = new Map<string, ResItem>();

  for (const n of nodes) {
    const c = n.data.config as Record<string, unknown>;
    const model = c.model as { provider?: string; model?: string } | undefined;
    if (model?.provider || model?.model) {
      const title = model.model ?? model.provider ?? "model";
      const key = `${model.provider ?? "?"}/${title}`;
      models.set(key, { key, title, sub: model.provider ?? "model" });
    }
    if (typeof c.tool === "string" && c.tool) {
      tools.set(c.tool, { key: c.tool, title: c.tool, sub: "tool" });
    }
    if (Array.isArray(c.tools)) {
      for (const t of c.tools as unknown[]) {
        if (typeof t === "string" && t) tools.set(t, { key: t, title: t, sub: "agent tool" });
      }
    }
    if (typeof c.store === "string" && c.store) {
      stores.set(c.store, { key: c.store, title: c.store, sub: "vector store" });
    }
  }

  return {
    models: [...models.values()],
    tools: [...tools.values()],
    stores: [...stores.values()],
  };
}

export function Resources() {
  const { nodes, activeFlow } = useWorkspace();
  const { models, tools, stores } = useMemo(() => derive(nodes), [nodes]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-3">
        <div className="text-[13px] font-semibold">Resources</div>
        <div className="text-[11px] text-muted-foreground">referenced by {activeFlow.name}</div>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        <Section title="Models" icon={Cpu} hue="--cat-model" items={models} />
        <Section title="Tools" icon={Wrench} hue="--cat-tool" items={tools} />
        <Section title="Knowledge" icon={Database} hue="--cat-data" items={stores} />
        <Section
          title="Secrets"
          icon={KeyRound}
          hue="--cat-io"
          items={[]}
          emptyHint="Declared per workspace — not yet wired."
        />
      </div>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  hue,
  items,
  emptyHint,
}: {
  title: string;
  icon: LucideIcon;
  hue: string;
  items: ResItem[];
  emptyHint?: string;
}) {
  return (
    <div style={{ "--cat": `var(${hue})` } as React.CSSProperties}>
      <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon size={13} className="text-[hsl(var(--cat))]" /> {title}
      </div>
      {items.length === 0 ? (
        <div className="px-1 py-1 text-[11px] text-muted-foreground">
          {emptyHint ?? "None referenced."}
        </div>
      ) : (
        items.map((it) => (
          <div key={it.key} className="mb-1 flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--cat))] text-white">
              <Icon size={14} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[12px] font-medium">{it.title}</div>
              <div className="truncate text-[11px] text-muted-foreground">{it.sub}</div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
