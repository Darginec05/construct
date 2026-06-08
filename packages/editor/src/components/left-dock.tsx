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
import { Tabs, TabsList, TabsPanel, TabsTab } from "./ui/tabs.tsx";

type PanelId = "nodes" | "outline" | "flows" | "resources";

const RAIL: { id: PanelId; icon: LucideIcon; label: string }[] = [
  { id: "nodes", icon: Boxes, label: "Nodes" },
  { id: "outline", icon: Layers, label: "Outline" },
  { id: "flows", icon: Workflow, label: "Flows" },
  { id: "resources", icon: Database, label: "Resources" },
];

const railTab =
  "inline-flex h-9 w-9 flex-none items-center justify-center rounded-md py-0 text-muted-foreground hover:bg-accent hover:text-foreground data-[selected]:bg-accent data-[selected]:text-foreground";

export function LeftDock() {
  const [active, setActive] = useState<PanelId>("nodes");
  const [collapsed, setCollapsed] = useState(false);

  return (
    <Tabs
      orientation="vertical"
      value={active}
      onValueChange={(value: string) => {
        setActive(value as PanelId);
        setCollapsed(false);
      }}
      className="flex h-full min-h-0"
    >
      <div className="flex w-[52px] shrink-0 flex-col items-center border-r border-border bg-card py-2">
        <TabsList className="flex flex-col items-center gap-1">
          {RAIL.map((it) => {
            const Icon = it.icon;
            return (
              <TabsTab key={it.id} value={it.id} title={it.label} className={railTab}>
                <Icon size={19} />
              </TabsTab>
            );
          })}
        </TabsList>
        <div className="flex-1" />
        <button
          type="button"
          title={collapsed ? "Expand" : "Collapse"}
          onClick={() => setCollapsed((c) => !c)}
          className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <PanelLeft size={19} className={collapsed ? "opacity-60" : ""} />
        </button>
      </div>

      <div
        className={`min-h-0 overflow-hidden border-border bg-card transition-[width] duration-200 ease-in-out ${
          collapsed ? "w-0 border-r-0" : "w-[272px] border-r"
        }`}
      >
        <div className="flex h-full w-[272px] min-h-0 flex-col">
          <TabsPanel value="nodes">
            <NodeLibrary />
          </TabsPanel>
          <TabsPanel value="outline">
            <Outline />
          </TabsPanel>
          <TabsPanel value="flows">
            <Flows />
          </TabsPanel>
          <TabsPanel value="resources">
            <Resources />
          </TabsPanel>
        </div>
      </div>
    </Tabs>
  );
}
