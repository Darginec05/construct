import { createContext, useCallback, useContext, useMemo, useRef } from "react";
import type { Flow, ValidationIssue } from "@construct/dsl";
import { fromDslFlow, toDslFlow } from "./serialize.ts";
import { useValidation } from "./validation-context.tsx";
import { useWorkspace } from "./workspace-context.tsx";

/**
 * Stable facade over the editor's internal state, for a host-injected copilot
 * (the cloud Chat UI mounted via `slots.copilot`). It speaks the canonical DSL
 * `Flow` — the same versioned contract the engine runs — so the copilot is never
 * coupled to the editor's internal reactflow shapes.
 *
 * The methods are imperative (read latest state when called, not at render), so
 * a chat handler can call `getActiveFlow()` → send to its backend → `applyFlow()`
 * the patched result without re-subscribing to context.
 */
export interface EditorApi {
  /** The active flow as canonical DSL — send this to the copilot backend. */
  getActiveFlow(): Flow;
  /** Ingest a patched DSL flow into the active canvas as ONE undo commit. */
  applyFlow(flow: Flow): void;
  /** Select a node and pan the canvas to it. */
  focusNode(id: string): void;
  /** Current validation issues for the active flow. */
  getIssues(): ValidationIssue[];
}

const EditorApiCtx = createContext<EditorApi | null>(null);

export function EditorApiProvider({ children }: { children: React.ReactNode }) {
  const { activeFlow, applyActiveFlow, focusNode } = useWorkspace();
  const { issues } = useValidation();

  // Refs so the imperative getters return the latest values even when called
  // from a handler that closed over an older render.
  const activeFlowRef = useRef(activeFlow);
  activeFlowRef.current = activeFlow;
  const issuesRef = useRef(issues);
  issuesRef.current = issues;

  const getActiveFlow = useCallback(() => toDslFlow(activeFlowRef.current), []);
  const getIssues = useCallback(() => issuesRef.current, []);
  const applyFlow = useCallback(
    (flow: Flow) => {
      // Keep the active doc's identity (id/kind/parent); take only the graph.
      // `fromDslFlow` omits an empty resources array, so read it from the DSL
      // flow directly — otherwise applyFlow could never clear stale resources.
      const doc = fromDslFlow(flow);
      applyActiveFlow({
        name: doc.name,
        nodes: doc.nodes,
        edges: doc.edges,
        resources: flow.resources,
      });
    },
    [applyActiveFlow],
  );

  const value = useMemo<EditorApi>(
    () => ({ getActiveFlow, applyFlow, focusNode, getIssues }),
    [getActiveFlow, applyFlow, focusNode, getIssues],
  );

  return <EditorApiCtx.Provider value={value}>{children}</EditorApiCtx.Provider>;
}

export function useEditorApi(): EditorApi {
  const ctx = useContext(EditorApiCtx);
  if (!ctx) throw new Error("useEditorApi must be used within a ConstructEditor");
  return ctx;
}
