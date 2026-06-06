import { useCallback, useRef } from "react";
import ReactFlow, {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeTypes,
  useEdgesState,
  useNodesState,
} from "reactflow";
import "reactflow/dist/style.css";
import { DND_TYPE } from "../components/node-library.tsx";
import { ConstructNode, type ConstructNodeData } from "./construct-node.tsx";

const nodeTypes: NodeTypes = { construct: ConstructNode };

const INITIAL_NODES: Node<ConstructNodeData>[] = [
  { id: "in", type: "construct", position: { x: 0, y: 120 }, data: { type: "input", config: {} } },
  { id: "ag", type: "construct", position: { x: 320, y: 120 }, data: { type: "agent", config: {} } },
  { id: "out", type: "construct", position: { x: 640, y: 120 }, data: { type: "output", config: {} } },
];

const INITIAL_EDGES: Edge[] = [
  { id: "e1", source: "in", target: "ag" },
  { id: "e2", source: "ag", target: "out" },
];

let nodeSeq = 0;

function CanvasInner() {
  const [nodes, setNodes, onNodesChange] = useNodesState(INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(INITIAL_EDGES);
  const wrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge(c, eds)),
    [setEdges],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData(DND_TYPE);
      if (!type) return;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const node: Node<ConstructNodeData> = {
        id: `${type}-${++nodeSeq}`,
        type: "construct",
        position,
        data: { type, config: {} },
      };
      setNodes((nds) => nds.concat(node));
    },
    [screenToFlowPosition, setNodes],
  );

  return (
    <div ref={wrapper} className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDrop={onDrop}
        onDragOver={onDragOver}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.5} color="hsl(var(--canvas-dot))" />
        <Controls />
      </ReactFlow>
    </div>
  );
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
