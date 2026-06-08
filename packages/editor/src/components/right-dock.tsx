import { useEffect, useState } from "react";
import { Box, Play, Sparkles, type LucideIcon } from "lucide-react";
import { Inspector } from "./inspector.tsx";
import { TestPanel } from "./test-panel.tsx";
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from "./ui/tabs.tsx";
import { useWorkspace } from "../flow/workspace-context.tsx";

type TabId = "copilot" | "test" | "inspector";

const TABS: { id: TabId; icon: LucideIcon; label: string }[] = [
  { id: "test", icon: Play, label: "Test" },
  { id: "inspector", icon: Box, label: "Inspector" },
];

export function RightDock({ copilot }: { copilot?: React.ReactNode }) {
  const { selectedId } = useWorkspace();
  const [tab, setTab] = useState<TabId>(!!copilot ? "copilot" : "inspector");

  useEffect(() => {
    if (selectedId) setTab("inspector");
  }, [selectedId]);

  const tabs = !!copilot ? [{ id: "copilot", icon: Sparkles, label: "Copilot" }, ...TABS] : TABS;

  return (
    <Tabs
      value={tab}
      onValueChange={(value: string) => setTab(value as TabId)}
      className="flex h-full flex-col"
    >
      <TabsList className="border-b border-border">
        {tabs.map((t) => {
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
        {/* keepMounted: an injected copilot holds chat state locally; without it
            a tab switch would unmount and wipe the conversation. */}
        {copilot && (
          <TabsPanel value="copilot" keepMounted>
            {copilot}
          </TabsPanel>
        )}
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
