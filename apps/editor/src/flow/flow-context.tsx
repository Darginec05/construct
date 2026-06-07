import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
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

  const patchActive = useCallback(
    (fn: (f: FlowDoc) => FlowDoc) => {
      setById((m) => ({ ...m, [activeFlowId]: fn(m[activeFlowId]!) }));
    },
    [activeFlowId],
  );

  const onNodesChange = useCallback<OnNodesChange>(
    (changes) => patchActive((f) => ({ ...f, nodes: applyNodeChanges(changes, f.nodes) })),
    [patchActive],
  );
  const onEdgesChange = useCallback<OnEdgesChange>(
    (changes) => patchActive((f) => ({ ...f, edges: applyEdgeChanges(changes, f.edges) })),
    [patchActive],
  );
  const setNodes = useCallback<NodesSetter>(
    (update) =>
      patchActive((f) => ({ ...f, nodes: typeof update === "function" ? update(f.nodes) : update })),
    [patchActive],
  );
  const setEdges = useCallback<EdgesSetter>(
    (update) =>
      patchActive((f) => ({ ...f, edges: typeof update === "function" ? update(f.edges) : update })),
    [patchActive],
  );
  const updateNodeConfig = useCallback(
    (id: string, patch: Record<string, unknown>) =>
      patchActive((f) => ({
        ...f,
        nodes: f.nodes.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, config: { ...n.data.config, ...patch } } } : n,
        ),
      })),
    [patchActive],
  );

  const setActiveFlowId = useCallback((id: string) => {
    setActiveId(id);
    setSelectedId(null);
  }, []);

  const renameFlow = useCallback((id: string, name: string) => {
    setById((m) => (m[id] ? { ...m, [id]: { ...m[id]!, name } } : m));
  }, []);

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
