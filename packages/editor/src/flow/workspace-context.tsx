import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  applyEdgeChanges,
  applyNodeChanges,
  type Edge,
  type OnEdgesChange,
  type OnNodesChange,
} from "reactflow";
import type { Resource } from "@construct/dsl";
import { toDslFlow } from "./serialize.ts";
import type { FlowDoc, FlowNode } from "./types.ts";

/** Stable content key for a doc: the canonical DSL projection, which drops
 *  reactflow-only UI noise (selection, measured width/height) so that clicks
 *  and post-mount measurement don't look like graph edits to the autosave. */
const dslKey = (doc: FlowDoc): string => JSON.stringify(toDslFlow(doc));

type NodesSetter = (update: FlowNode[] | ((prev: FlowNode[]) => FlowNode[])) => void;
type EdgesSetter = (update: Edge[] | ((prev: Edge[]) => Edge[])) => void;

interface HistEntry {
  byId: Record<string, FlowDoc>;
  activeFlowId: string;
}

/** Graph payload for {@link WorkspaceStore.applyActiveFlow}. */
export interface ApplyActiveFlowInput {
  name?: string;
  nodes: FlowNode[];
  edges: Edge[];
  resources?: Resource[];
}

const HISTORY_LIMIT = 100;
const FLOW_CHANGE_DEBOUNCE_MS = 800;

interface WorkspaceStore {
  flows: FlowDoc[];
  activeFlow: FlowDoc;
  activeFlowId: string;
  setActiveFlowId: (id: string) => void;
  renameFlow: (id: string, name: string) => void;
  /** Replace the entire workspace (used to load a ready-made example). */
  loadWorkspace: (docs: FlowDoc[]) => void;
  /** Replace the active flow's graph (name/nodes/edges/resources) as ONE undo
   *  commit — used by the copilot facade to ingest a patched DSL Flow. */
  applyActiveFlow: (next: ApplyActiveFlowInput) => void;
  /** Bumped whenever the workspace is replaced, so dependent contexts (run,
   *  inputs) can reset without the outer provider reaching into them. */
  epoch: number;
  nodes: FlowNode[];
  edges: Edge[];
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  setNodes: NodesSetter;
  setEdges: EdgesSetter;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  selectedNode: FlowNode | null;
  updateNodeConfig: (id: string, patch: Record<string, unknown>) => void;
  /** Select a node and pan the canvas to it (used to locate a validation issue). */
  focusNode: (id: string) => void;
  focusTarget: { id: string; seq: number } | null;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const WorkspaceCtx = createContext<WorkspaceStore | null>(null);

const keyBy = (docs: FlowDoc[]): Record<string, FlowDoc> =>
  Object.fromEntries(docs.map((f) => [f.id, f]));

// Crash-safe fallback when the host supplies no `initialFlows`: a single blank
// main flow so the editor always has an active doc. Real seed data (demos,
// tenant flows) lives in the host and arrives through `initialFlows`.
const EMPTY_WORKSPACE: FlowDoc[] = [{ id: "main", name: "Untitled", kind: "main", nodes: [], edges: [] }];

type WorkspaceProviderProps = {
  initialFlows?: FlowDoc[];
  onFlowChange?: (doc: FlowDoc) => void;
  children: React.ReactNode;
}

export function WorkspaceProvider({
  initialFlows,
  onFlowChange,
  children,
}: WorkspaceProviderProps) {
  const seed = initialFlows && initialFlows.length > 0 ? initialFlows : EMPTY_WORKSPACE;
  const [order, setOrder] = useState<string[]>(() => seed.map((f) => f.id));
  const [byId, setById] = useState<Record<string, FlowDoc>>(() => keyBy(seed));
  const [activeFlowId, setActiveId] = useState<string>(() => seed[0]!.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);

  const activeFlow = byId[activeFlowId]!;

  // --- undo / redo ---------------------------------------------------------
  // History snapshots the whole document (every flow) plus the active flow, so
  // undo also restores which flow you were editing. Refs are the source of
  // truth; a counter bumps to re-render the toolbar's enabled state.
  const byIdRef = useRef(byId);
  byIdRef.current = byId;
  const activeIdRef = useRef(activeFlowId);
  activeIdRef.current = activeFlowId;

  const pastRef = useRef<HistEntry[]>([]);
  const futureRef = useRef<HistEntry[]>([]);
  const lastCommitRef = useRef<{ tag: string; time: number } | null>(null);
  const draggingRef = useRef(false);
  const [histVer, bumpHistory] = useState(0);

  const snapshot = useCallback(
    (): HistEntry => ({ byId: byIdRef.current, activeFlowId: activeIdRef.current }),
    [],
  );

  // Record a restore point of the *current* state. Call before applying a
  // mutation. `coalesceMs` folds rapid same-tag edits (typing, dragging) into
  // a single entry.
  const commit = useCallback(
    (tag: string, coalesceMs = 0) => {
      const now = Date.now();
      const last = lastCommitRef.current;
      if (coalesceMs > 0 && last && last.tag === tag && now - last.time < coalesceMs) {
        lastCommitRef.current = { tag, time: now };
        return;
      }
      pastRef.current = [...pastRef.current, snapshot()].slice(-HISTORY_LIMIT);
      futureRef.current = [];
      lastCommitRef.current = { tag, time: now };
      bumpHistory((n) => n + 1);
    },
    [snapshot],
  );

  const patchActive = useCallback(
    (fn: (f: FlowDoc) => FlowDoc) => {
      setById((m) => ({ ...m, [activeFlowId]: fn(m[activeFlowId]!) }));
    },
    [activeFlowId],
  );

  const onNodesChange = useCallback<OnNodesChange>(
    (changes) => {
      if (changes.some((c) => c.type === "remove")) commit("remove", 250);
      else if (changes.some((c) => c.type === "position" && c.dragging) && !draggingRef.current) {
        commit("move");
      }
      if (changes.some((c) => c.type === "position" && c.dragging)) draggingRef.current = true;
      if (changes.some((c) => c.type === "position" && c.dragging === false)) draggingRef.current = false;
      patchActive((f) => ({ ...f, nodes: applyNodeChanges(changes, f.nodes) }));
    },
    [patchActive, commit],
  );
  const onEdgesChange = useCallback<OnEdgesChange>(
    (changes) => {
      if (changes.some((c) => c.type === "remove")) commit("remove", 250);
      patchActive((f) => ({ ...f, edges: applyEdgeChanges(changes, f.edges) }));
    },
    [patchActive, commit],
  );
  const setNodes = useCallback<NodesSetter>(
    (update) => {
      commit("structural");
      patchActive((f) => ({ ...f, nodes: typeof update === "function" ? update(f.nodes) : update }));
    },
    [patchActive, commit],
  );
  const setEdges = useCallback<EdgesSetter>(
    (update) => {
      commit("structural");
      patchActive((f) => ({ ...f, edges: typeof update === "function" ? update(f.edges) : update }));
    },
    [patchActive, commit],
  );
  const updateNodeConfig = useCallback(
    (id: string, patch: Record<string, unknown>) => {
      commit(`config:${id}`, 500);
      patchActive((f) => ({
        ...f,
        nodes: f.nodes.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, config: { ...n.data.config, ...patch } } } : n,
        ),
      }));
    },
    [patchActive, commit],
  );

  const setActiveFlowId = useCallback((id: string) => {
    setActiveId(id);
    setSelectedId(null);
  }, []);

  const renameFlow = useCallback(
    (id: string, name: string) => {
      commit(`rename:${id}`, 600);
      setById((m) => (m[id] ? { ...m, [id]: { ...m[id]!, name } } : m));
    },
    [commit],
  );

  const applyEntry = useCallback((entry: HistEntry) => {
    setById(entry.byId);
    setActiveId(entry.activeFlowId);
    setSelectedId(null);
    lastCommitRef.current = null;
  }, []);

  const undo = useCallback(() => {
    if (pastRef.current.length === 0) return;
    const prev = pastRef.current[pastRef.current.length - 1]!;
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [...futureRef.current, snapshot()];
    applyEntry(prev);
    bumpHistory((n) => n + 1);
  }, [snapshot, applyEntry]);

  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return;
    const next = futureRef.current[futureRef.current.length - 1]!;
    futureRef.current = futureRef.current.slice(0, -1);
    pastRef.current = [...pastRef.current, snapshot()];
    applyEntry(next);
    bumpHistory((n) => n + 1);
  }, [snapshot, applyEntry]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) return;
      if (el?.isContentEditable) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // Notify the host (debounced, per flow) when a flow's graph changes, so the
  // cloud can autosave. The ref-diff is a cheap pre-filter; the actual decision
  // to emit compares the canonical DSL projection (`dslKey`) against the last
  // value sent, so reactflow UI noise (selection, post-mount measurement) and
  // undo-to-identical never trigger a redundant save. Seeded from the initial
  // docs, so the first measurement pass after mount stays silent. Deletions
  // aren't reported — a removed id simply stops emitting.
  const onFlowChangeRef = useRef(onFlowChange);
  onFlowChangeRef.current = onFlowChange;
  const emitTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastSentRef = useRef<Map<string, string> | null>(null);
  if (lastSentRef.current === null) {
    lastSentRef.current = new Map(seed.map((d) => [d.id, dslKey(d)]));
  }
  const prevByIdRef = useRef(byId);
  useEffect(() => {
    const prev = prevByIdRef.current;
    prevByIdRef.current = byId;
    if (!onFlowChangeRef.current) return;
    const timers = emitTimersRef.current;
    for (const id of Object.keys(byId)) {
      if (byId[id] === prev[id]) continue;
      const pending = timers.get(id);
      if (pending) clearTimeout(pending);
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id);
          const doc = byIdRef.current[id];
          if (!doc) return;
          const key = dslKey(doc);
          if (lastSentRef.current!.get(id) === key) return;
          lastSentRef.current!.set(id, key);
          onFlowChangeRef.current?.(doc);
        }, FLOW_CHANGE_DEBOUNCE_MS),
      );
    }
  }, [byId]);
  useEffect(() => {
    const timers = emitTimersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  const flows = useMemo(() => order.map((id) => byId[id]!), [order, byId]);
  const selectedNode = useMemo(
    () => activeFlow.nodes.find((n) => n.id === selectedId) ?? null,
    [activeFlow, selectedId],
  );

  const [focusTarget, setFocusTarget] = useState<{ id: string; seq: number } | null>(null);
  const focusSeq = useRef(0);
  const focusNode = useCallback((id: string) => {
    setSelectedId(id);
    setFocusTarget({ id, seq: ++focusSeq.current });
  }, []);

  const applyActiveFlow = useCallback(
    (next: ApplyActiveFlowInput) => {
      commit("apply-flow");
      patchActive((f) => ({
        ...f,
        ...(next.name !== undefined ? { name: next.name } : {}),
        nodes: next.nodes,
        edges: next.edges,
        ...(next.resources !== undefined ? { resources: next.resources } : {}),
      }));
    },
    [patchActive, commit],
  );

  const loadWorkspace = useCallback((docs: FlowDoc[]) => {
    if (docs.length === 0) return;
    setOrder(docs.map((d) => d.id));
    setById(keyBy(docs));
    setActiveId(docs[0]!.id);
    setSelectedId(null);
    pastRef.current = [];
    futureRef.current = [];
    lastCommitRef.current = null;
    bumpHistory((n) => n + 1);
    setEpoch((n) => n + 1);
  }, []);

  const value = useMemo<WorkspaceStore>(
    () => ({
      flows,
      activeFlow,
      activeFlowId,
      setActiveFlowId,
      renameFlow,
      loadWorkspace,
      applyActiveFlow,
      epoch,
      nodes: activeFlow.nodes,
      edges: activeFlow.edges,
      onNodesChange,
      onEdgesChange,
      setNodes,
      setEdges,
      selectedId,
      setSelectedId,
      selectedNode,
      updateNodeConfig,
      focusNode,
      focusTarget,
      undo,
      redo,
      canUndo: pastRef.current.length > 0,
      canRedo: futureRef.current.length > 0,
    }),
    [
      flows,
      activeFlow,
      activeFlowId,
      setActiveFlowId,
      renameFlow,
      loadWorkspace,
      applyActiveFlow,
      epoch,
      onNodesChange,
      onEdgesChange,
      setNodes,
      setEdges,
      selectedId,
      selectedNode,
      updateNodeConfig,
      focusNode,
      focusTarget,
      undo,
      redo,
      histVer,
    ],
  );

  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>;
}

export function useWorkspace(): WorkspaceStore {
  const ctx = useContext(WorkspaceCtx);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
