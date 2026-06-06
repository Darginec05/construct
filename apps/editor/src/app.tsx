import { NodeLibrary } from "./components/node-library.tsx";
import { Canvas } from "./flow/canvas.tsx";

export function App() {
  return (
    <div className="grid h-full grid-rows-[52px_1fr]">
      <header className="flex items-center gap-3 border-b border-border px-4">
        <span className="text-sm font-semibold tracking-tight">Construct</span>
      </header>
      <div className="grid grid-cols-[286px_1fr_380px] overflow-hidden">
        <aside className="border-r border-border bg-card">
          <NodeLibrary />
        </aside>
        <main className="bg-canvas-bg">
          <Canvas />
        </main>
        <aside className="border-l border-border bg-card" />
      </div>
    </div>
  );
}
