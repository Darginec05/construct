import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  applyEdgeChanges,
  applyNodeChanges,
  type Edge,
  type Node,
  type OnEdgesChange,
  type OnNodesChange,
} from "reactflow";
import type { RunEvent } from "@construct/engine";
import { executeFlow } from "../lib/runtime.ts";
import type { ConstructNodeData } from "./construct-node.tsx";

export type FlowNode = Node<ConstructNodeData>;
export type FlowKind = "main" | "sub";

export type RunStatus = "idle" | "running" | "completed" | "paused" | "failed";
export type NodeRunState = "running" | "done" | "error";

export interface FlowDoc {
  id: string;
  name: string;
  kind: FlowKind;
  parent?: string;
  nodes: FlowNode[];
  edges: Edge[];
}

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

interface FlowStore {
  flows: FlowDoc[];
  activeFlow: FlowDoc;
  activeFlowId: string;
  setActiveFlowId: (id: string) => void;
  renameFlow: (id: string, name: string) => void;
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
  // --- undo / redo ---
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  // --- sandbox run state ---
  runStatus: RunStatus;
  nodeRun: Record<string, NodeRunState>;
  trace: RunEvent[];
  runOutput: unknown;
  runError: string | null;
  inputValues: Record<string, string>;
  setInputValue: (key: string, value: string) => void;
  runActiveFlow: () => Promise<void>;
  clearRun: () => void;
}

const FlowCtx = createContext<FlowStore | null>(null);

const keyBy = (docs: FlowDoc[]): Record<string, FlowDoc> =>
  Object.fromEntries(docs.map((f) => [f.id, f]));

export function FlowProvider({ children }: { children: React.ReactNode }) {
  const [order] = useState<string[]>(() => INITIAL_FLOWS.map((f) => f.id));
  const [byId, setById] = useState<Record<string, FlowDoc>>(() => keyBy(INITIAL_FLOWS));
  const [activeFlowId, setActiveId] = useState<string>(() => INITIAL_FLOWS[0]!.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [nodeRun, setNodeRun] = useState<Record<string, NodeRunState>>({});
  const [trace, setTrace] = useState<RunEvent[]>([]);
  const [runOutput, setRunOutput] = useState<unknown>(undefined);
  const [runError, setRunError] = useState<string | null>(null);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});

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

  // Keep a live snapshot so run callbacks always see the latest graph + inputs
  // without re-creating on every keystroke.
  const snapRef = useRef({ activeFlow, flows, inputValues });
  snapRef.current = { activeFlow, flows, inputValues };

  const setInputValue = useCallback((key: string, value: string) => {
    setInputValues((v) => ({ ...v, [key]: value }));
  }, []);

  const clearRun = useCallback(() => {
    setRunStatus("idle");
    setNodeRun({});
    setTrace([]);
    setRunOutput(undefined);
    setRunError(null);
  }, []);

  const runActiveFlow = useCallback(async () => {
    const { activeFlow, flows, inputValues } = snapRef.current;
    setRunStatus("running");
    setNodeRun({});
    setTrace([]);
    setRunOutput(undefined);
    setRunError(null);

    const inputNode = activeFlow.nodes.find((n) => n.data.type === "input");
    const schema = (inputNode?.data.config.schema as Record<string, string> | undefined) ?? {};
    const input: Record<string, unknown> = {};
    for (const [key, type] of Object.entries(schema)) {
      const raw = inputValues[key] ?? "";
      input[key] = type.includes("number") ? Number(raw) : raw;
    }

    try {
      const result = await executeFlow(activeFlow, flows, input, (event) => {
        setTrace((t) => [...t, event]);
        if (event.nodeId == null) return;
        const id = event.nodeId;
        if (event.type === "node-start") setNodeRun((m) => ({ ...m, [id]: "running" }));
        else if (event.type === "node-finish") setNodeRun((m) => ({ ...m, [id]: "done" }));
        else if (event.type === "error") setNodeRun((m) => ({ ...m, [id]: "error" }));
      });
      setRunStatus(result.status);
      setRunOutput(result.output);
      setRunError(result.error ?? null);
    } catch (err) {
      setRunStatus("failed");
      setRunError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const value = useMemo<FlowStore>(
    () => ({
      flows,
      activeFlow,
      activeFlowId,
      setActiveFlowId,
      renameFlow,
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
      undo,
      redo,
      canUndo: pastRef.current.length > 0,
      canRedo: futureRef.current.length > 0,
      runStatus,
      nodeRun,
      trace,
      runOutput,
      runError,
      inputValues,
      setInputValue,
      runActiveFlow,
      clearRun,
    }),
    [
      flows,
      activeFlow,
      activeFlowId,
      setActiveFlowId,
      renameFlow,
      onNodesChange,
      onEdgesChange,
      setNodes,
      setEdges,
      selectedId,
      selectedNode,
      updateNodeConfig,
      undo,
      redo,
      histVer,
      runStatus,
      nodeRun,
      trace,
      runOutput,
      runError,
      inputValues,
      setInputValue,
      runActiveFlow,
      clearRun,
    ],
  );

  return <FlowCtx.Provider value={value}>{children}</FlowCtx.Provider>;
}

export function useFlow(): FlowStore {
  const ctx = useContext(FlowCtx);
  if (!ctx) throw new Error("useFlow must be used within FlowProvider");
  return ctx;
}
