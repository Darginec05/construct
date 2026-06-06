import { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type OnEdgesChange,
  type OnNodesChange,
} from "reactflow";
import type { ConstructNodeData } from "./construct-node.tsx";

export type FlowNode = Node<ConstructNodeData>;

const INITIAL_NODES: FlowNode[] = [
  { id: "in", type: "construct", position: { x: 0, y: 120 }, data: { type: "input", config: {} } },
  { id: "ag", type: "construct", position: { x: 320, y: 120 }, data: { type: "agent", config: {} } },
  { id: "out", type: "construct", position: { x: 640, y: 120 }, data: { type: "output", config: {} } },
];

const INITIAL_EDGES: Edge[] = [
  { id: "e1", source: "in", target: "ag" },
  { id: "e2", source: "ag", target: "out" },
];

interface FlowStore {
  nodes: FlowNode[];
  edges: Edge[];
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  setNodes: ReturnType<typeof useNodesState<ConstructNodeData>>[1];
  setEdges: ReturnType<typeof useEdgesState>[1];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  selectedNode: FlowNode | null;
  updateNodeConfig: (id: string, patch: Record<string, unknown>) => void;
}

const FlowCtx = createContext<FlowStore | null>(null);

export function FlowProvider({ children }: { children: React.ReactNode }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<ConstructNodeData>(INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(INITIAL_EDGES);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const updateNodeConfig = useCallback(
    (id: string, patch: Record<string, unknown>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, config: { ...n.data.config, ...patch } } } : n,
        ),
      );
    },
    [setNodes],
  );

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedId) ?? null,
    [nodes, selectedId],
  );

  const value = useMemo<FlowStore>(
    () => ({
      nodes,
      edges,
      onNodesChange,
      onEdgesChange,
      setNodes,
      setEdges,
      selectedId,
      setSelectedId,
      selectedNode,
      updateNodeConfig,
    }),
    [nodes, edges, onNodesChange, onEdgesChange, setNodes, setEdges, selectedId, selectedNode, updateNodeConfig],
  );

  return <FlowCtx.Provider value={value}>{children}</FlowCtx.Provider>;
}

export function useFlow(): FlowStore {
  const ctx = useContext(FlowCtx);
  if (!ctx) throw new Error("useFlow must be used within FlowProvider");
  return ctx;
}
