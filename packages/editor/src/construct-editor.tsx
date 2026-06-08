import { useCallback, useMemo, useState } from "react";
import type { ConstructClient } from "@construct/client";
import { LeftDock } from "./components/left-dock.tsx";
import { ReaderView } from "./components/reader-view.tsx";
import { RightDock } from "./components/right-dock.tsx";
import { TopBar, type ViewMode } from "./components/top-bar.tsx";
import { Canvas } from "./flow/canvas.tsx";
import { FlowProvider } from "./flow/flow-context.tsx";
import {
  fromWorkspaceFlow,
  toWorkspaceFlow,
  type WorkspaceFlow,
  type WorkspaceFlowInput,
} from "./flow/serialize.ts";
import type { FlowDoc } from "./flow/types.ts";

/**
 * Host-injected UI mount points. A slot is rendered inside the editor's provider
 * tree, so its content can drive the canvas via {@link useEditorApi}.
 */
export interface EditorSlots {
  /**
   * Replaces the right-dock "Copilot" tab. The cloud Chat UI mounts here and
   * speaks DSL through `useEditorApi()`. When omitted, an OSS stub is shown.
   */
  copilot?: React.ReactNode;
}

export interface ConstructEditorProps {
  /**
   * Self-host server connection. When `null` (the default) the editor runs as a
   * pure sandbox — Publish is disabled and runs use the simulated provider. The
   * host owns env and constructs this; the library never reads `VITE_*`.
   */
  client?: ConstructClient | null;
  /** Host-injected UI mount points (e.g. the cloud copilot panel). */
  slots?: EditorSlots;
  /**
   * Seed the workspace (uncontrolled — read once at mount). Omit to start with a
   * single blank flow; the host (OSS playground or cloud) passes its own flows.
   */
  initialFlows?: WorkspaceFlowInput[];
  /**
   * Fired (debounced) with each flow whose graph changed, so the cloud can
   * autosave. Speaks DSL; selection and active-tab changes are not reported,
   * and flow deletions are not emitted (the id simply stops changing).
   */
  onFlowChange?: (flow: WorkspaceFlow) => void;
}

export function ConstructEditor({ client = null, slots, initialFlows, onFlowChange }: ConstructEditorProps) {
  const [view, setView] = useState<ViewMode>("canvas");
  const [rightCollapsed, setRightCollapsed] = useState(false);

  const seedFlows = useMemo(() => initialFlows?.map(fromWorkspaceFlow), [initialFlows]);
  const handleFlowChange = useCallback(
    (doc: FlowDoc) => onFlowChange?.(toWorkspaceFlow(doc)),
    [onFlowChange],
  );

  return (
    <FlowProvider
      client={client}
      initialFlows={seedFlows}
      onFlowChange={onFlowChange ? handleFlowChange : undefined}
    >
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
              <RightDock copilot={slots?.copilot} />
            </div>
          </aside>
        </div>
      </div>
    </FlowProvider>
  );
}
