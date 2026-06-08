import { useEffect, useState } from "react";
import { Box, Play, Sparkles, type LucideIcon } from "lucide-react";
import { Copilot } from "./copilot.tsx";
import { Inspector } from "./inspector.tsx";
import { TestPanel } from "./test-panel.tsx";
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from "./ui/tabs.tsx";
import { useWorkspace } from "../flow/workspace-context.tsx";

type TabId = "copilot" | "test" | "inspector";

const TABS: { id: TabId; icon: LucideIcon; label: string }[] = [
  { id: "copilot", icon: Sparkles, label: "Copilot" },
  { id: "test", icon: Play, label: "Test" },
  { id: "inspector", icon: Box, label: "Inspector" },
];

export function RightDock() {
  const { selectedId } = useWorkspace();
  const [tab, setTab] = useState<TabId>("inspector");

  useEffect(() => {
    if (selectedId) setTab("inspector");
  }, [selectedId]);

  return (
    <Tabs
      value={tab}
      onValueChange={(value: string) => setTab(value as TabId)}
      className="flex h-full flex-col"
    >
      <TabsList className="border-b border-border">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <TabsTab key={t.id} value={t.id}>
              <Icon size={14} /> {t.label}
            </TabsTab>
          );
        })}
        <TabsIndicator />
      </TabsList>
      <div className="min-h-0 flex-1">
        <TabsPanel value="copilot">
          <Copilot />
        </TabsPanel>
        <TabsPanel value="test">
          <TestPanel />
        </TabsPanel>
        <TabsPanel value="inspector">
          <Inspector />
        </TabsPanel>
      </div>
    </Tabs>
  );
}
