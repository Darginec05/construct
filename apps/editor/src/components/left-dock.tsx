import { useState } from "react";
import {
  Boxes,
  Database,
  Layers,
  PanelLeft,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { Flows } from "./flows.tsx";
import { NodeLibrary } from "./node-library.tsx";
import { Outline } from "./outline.tsx";
import { Resources } from "./resources.tsx";

type PanelId = "nodes" | "outline" | "flows" | "resources";

const RAIL: { id: PanelId; icon: LucideIcon; label: string }[] = [
  { id: "nodes", icon: Boxes, label: "Nodes" },
  { id: "outline", icon: Layers, label: "Outline" },
  { id: "flows", icon: Workflow, label: "Flows" },
  { id: "resources", icon: Database, label: "Resources" },
];

export function LeftDock() {
  const [active, setActive] = useState<PanelId>("nodes");
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-full">
      <div className="flex w-[52px] shrink-0 flex-col items-center gap-1 border-r border-border bg-card py-2">
        {RAIL.map((it) => {
          const Icon = it.icon;
          const on = !collapsed && active === it.id;
          return (
            <button
              key={it.id}
              type="button"
              title={it.label}
              onClick={() => {
                setCollapsed(false);
                setActive(it.id);
              }}
              className={`flex h-9 w-9 items-center justify-center rounded-md ${
                on ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <Icon size={19} />
            </button>
          );
        })}
        <div className="flex-1" />
        <button
          type="button"
          title={collapsed ? "Expand" : "Collapse"}
          onClick={() => setCollapsed((c) => !c)}
          className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <PanelLeft size={19} />
        </button>
      </div>

      {collapsed ? null : (
        <div className="w-[272px] shrink-0 border-r border-border bg-card">
          {active === "nodes" ? (
            <NodeLibrary />
          ) : active === "outline" ? (
            <Outline />
          ) : active === "flows" ? (
            <Flows />
          ) : (
            <Resources />
          )}
        </div>
      )}
    </div>
  );
}
