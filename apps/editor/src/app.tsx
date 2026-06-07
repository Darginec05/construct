import { useState } from "react";
import { LeftDock } from "./components/left-dock.tsx";
import { ReaderView } from "./components/reader-view.tsx";
import { RightDock } from "./components/right-dock.tsx";
import { TopBar, type ViewMode } from "./components/top-bar.tsx";
import { Canvas } from "./flow/canvas.tsx";
import { FlowProvider } from "./flow/flow-context.tsx";

export function App() {
  const [view, setView] = useState<ViewMode>("canvas");
  const [rightCollapsed, setRightCollapsed] = useState(false);

  return (
    <FlowProvider>
      <div className="grid h-full grid-rows-[52px_minmax(0,1fr)]">
        <TopBar
          view={view}
          onViewChange={setView}
          rightCollapsed={rightCollapsed}
          onToggleRight={() => setRightCollapsed((c) => !c)}
        />
        <div className="flex min-h-0 overflow-hidden">
          <LeftDock />
          <main className="min-h-0 flex-1 overflow-hidden bg-canvas-bg">
            {view === "canvas" ? <Canvas /> : <ReaderView />}
          </main>
          <aside
            className={`min-h-0 shrink-0 overflow-hidden bg-card transition-[width] duration-200 ease-in-out ${
              rightCollapsed ? "w-0" : "w-[380px]"
            }`}
          >
            <div className="h-full w-[380px] border-l border-border">
              <RightDock />
            </div>
          </aside>
        </div>
      </div>
    </FlowProvider>
  );
}
