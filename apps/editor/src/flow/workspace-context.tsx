import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  applyEdgeChanges,
  applyNodeChanges,
  type Edge,
  type OnEdgesChange,
  type OnNodesChange,
} from "reactflow";
import type { FlowDoc, FlowNode } from "./types.ts";

const INITIAL_FLOWS: FlowDoc[] = [
  {
    id: "main",
    name: "Assistant",
    kind: "main",
    nodes: [
      { id: "in", type: "construct", position: { x: 0, y: 120 }, data: { type: "input", config: { schema: { message: "text" } } } },
      {
        id: "ag",
        type: "construct",
        position: { x: 320, y: 120 },
        data: {
          type: "agent",
          config: {
            model: { provider: "anthropic", model: "claude-sonnet-4-6" },
            prompt: "{{ $.message }}",
            writeTo: "reply",
          },
        },
      },
      { id: "out", type: "construct", position: { x: 640, y: 120 }, data: { type: "output", config: { from: "$.reply" } } },
    ],
    edges: [
      { id: "e1", source: "in", target: "ag" },
      { id: "e2", source: "ag", target: "out" },
    ],
  },
  {
    id: "reviewer",
    name: "Reviewer",
    kind: "sub",
    parent: "main",
    nodes: [
      { id: "r-in", type: "construct", position: { x: 0, y: 120 }, data: { type: "input", config: { schema: { draft: "text" } } } },
      {
        id: "r-ag",
        type: "construct",
        position: { x: 320, y: 120 },
        data: {
          type: "agent",
          config: {
            model: { provider: "anthropic", model: "claude-sonnet-4-6" },
            prompt: "{{ $.draft }}",
            writeTo: "review",
          },
        },
      },
      { id: "r-out", type: "construct", position: { x: 640, y: 120 }, data: { type: "output", config: { from: "$.review" } } },
    ],
    edges: [
      { id: "re1", source: "r-in", target: "r-ag" },
      { id: "re2", source: "r-ag", target: "r-out" },
    ],
  },
];

type NodesSetter = (update: FlowNode[] | ((prev: FlowNode[]) => FlowNode[])) => void;
type EdgesSetter = (update: Edge[] | ((prev: Edge[]) => Edge[])) => void;

interface HistEntry {
  byId: Record<string, FlowDoc>;
  activeFlowId: string;
}

const HISTORY_LIMIT = 100;

interface WorkspaceStore {
  flows: FlowDoc[];
  activeFlow: FlowDoc;
  activeFlowId: string;
  setActiveFlowId: (id: string) => void;
  renameFlow: (id: string, name: string) => void;
  /** Replace the entire workspace (used to load a ready-made example). */
  loadWorkspace: (docs: FlowDoc[]) => void;
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

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [order, setOrder] = useState<string[]>(() => INITIAL_FLOWS.map((f) => f.id));
  const [byId, setById] = useState<Record<string, FlowDoc>>(() => keyBy(INITIAL_FLOWS));
  const [activeFlowId, setActiveId] = useState<string>(() => INITIAL_FLOWS[0]!.id);
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
