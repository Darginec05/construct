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
        <div
          className="grid min-h-0 grid-rows-[minmax(0,1fr)] overflow-hidden"
          style={{ gridTemplateColumns: `auto 1fr ${rightCollapsed ? "0px" : "380px"}` }}
        >
          <LeftDock />
          <main className="min-h-0 overflow-hidden bg-canvas-bg">
            {view === "canvas" ? <Canvas /> : <ReaderView />}
          </main>
          <aside className={`min-h-0 overflow-hidden border-l border-border bg-card ${rightCollapsed ? "hidden" : ""}`}>
            <RightDock />
          </aside>
        </div>
      </div>
    </FlowProvider>
  );
}
