import { useEffect, useState } from "react";
import { Box, Play, Sparkles, type LucideIcon } from "lucide-react";
import { Copilot } from "./copilot.tsx";
import { Inspector } from "./inspector.tsx";
import { TestPanel } from "./test-panel.tsx";
import { useFlow } from "../flow/flow-context.tsx";

type TabId = "copilot" | "test" | "inspector";

const TABS: { id: TabId; icon: LucideIcon; label: string }[] = [
  { id: "copilot", icon: Sparkles, label: "Copilot" },
  { id: "test", icon: Play, label: "Test" },
  { id: "inspector", icon: Box, label: "Inspector" },
];

export function RightDock() {
  const { selectedId } = useFlow();
  const [tab, setTab] = useState<TabId>("inspector");

  useEffect(() => {
    if (selectedId) setTab("inspector");
  }, [selectedId]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex border-b border-border">
        {TABS.map((t) => {
          const Icon = t.icon;
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2.5 text-[12px] font-medium transition ${
                on
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>
      <div className="min-h-0 flex-1">
        {tab === "copilot" ? <Copilot /> : tab === "test" ? <TestPanel /> : <Inspector />}
      </div>
    </div>
  );
}
