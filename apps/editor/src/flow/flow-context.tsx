import { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
  applyEdgeChanges,
  applyNodeChanges,
  type Edge,
  type Node,
  type OnEdgesChange,
  type OnNodesChange,
} from "reactflow";
import type { ConstructNodeData } from "./construct-node.tsx";

export type FlowNode = Node<ConstructNodeData>;
export type FlowKind = "main" | "sub";

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
      { id: "in", type: "construct", position: { x: 0, y: 120 }, data: { type: "input", config: {} } },
      { id: "ag", type: "construct", position: { x: 320, y: 120 }, data: { type: "agent", config: {} } },
      { id: "out", type: "construct", position: { x: 640, y: 120 }, data: { type: "output", config: {} } },
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
      { id: "r-in", type: "construct", position: { x: 0, y: 120 }, data: { type: "input", config: {} } },
      { id: "r-ag", type: "construct", position: { x: 320, y: 120 }, data: { type: "agent", config: {} } },
      { id: "r-out", type: "construct", position: { x: 640, y: 120 }, data: { type: "output", config: {} } },
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
}

const FlowCtx = createContext<FlowStore | null>(null);

const keyBy = (docs: FlowDoc[]): Record<string, FlowDoc> =>
  Object.fromEntries(docs.map((f) => [f.id, f]));

export function FlowProvider({ children }: { children: React.ReactNode }) {
  const [order] = useState<string[]>(() => INITIAL_FLOWS.map((f) => f.id));
  const [byId, setById] = useState<Record<string, FlowDoc>>(() => keyBy(INITIAL_FLOWS));
  const [activeFlowId, setActiveId] = useState<string>(() => INITIAL_FLOWS[0]!.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const flows = useMemo(() => order.map((id) => byId[id]!), [order, byId]);
  const selectedNode = useMemo(
    () => activeFlow.nodes.find((n) => n.id === selectedId) ?? null,
    [activeFlow, selectedId],
  );

  const value = useMemo<FlowStore>(
    () => ({
      flows,
      activeFlow,
      activeFlowId,
      setActiveFlowId,
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
    }),
    [
      flows,
      activeFlow,
      activeFlowId,
      setActiveFlowId,
      onNodesChange,
      onEdgesChange,
      setNodes,
      setEdges,
      selectedId,
      selectedNode,
      updateNodeConfig,
    ],
  );

  return <FlowCtx.Provider value={value}>{children}</FlowCtx.Provider>;
}

export function useFlow(): FlowStore {
  const ctx = useContext(FlowCtx);
  if (!ctx) throw new Error("useFlow must be used within FlowProvider");
  return ctx;
}
