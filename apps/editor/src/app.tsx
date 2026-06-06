import { useState } from "react";
import { Inspector } from "./components/inspector.tsx";
import { LeftDock } from "./components/left-dock.tsx";
import { ReaderView } from "./components/reader-view.tsx";
import { TopBar, type ViewMode } from "./components/top-bar.tsx";
import { Canvas } from "./flow/canvas.tsx";
import { FlowProvider } from "./flow/flow-context.tsx";

export function App() {
  const [view, setView] = useState<ViewMode>("canvas");

  return (
    <FlowProvider>
      <div className="grid h-full grid-rows-[52px_1fr]">
        <TopBar view={view} onViewChange={setView} />
        <div className="grid grid-cols-[auto_1fr_380px] overflow-hidden">
          <LeftDock />
          <main className="overflow-hidden bg-canvas-bg">
            {view === "canvas" ? <Canvas /> : <ReaderView />}
          </main>
          <aside className="border-l border-border bg-card">
            <Inspector />
          </aside>
        </div>
      </div>
    </FlowProvider>
  );
}
