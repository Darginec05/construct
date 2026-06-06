import { useCallback } from "react";
import ReactFlow, {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Node,
} from "reactflow";
import "reactflow/dist/style.css";
import { DND_TYPE } from "../components/node-library.tsx";
import { ConstructNode, type ConstructNodeData } from "./construct-node.tsx";
import { useFlow } from "./flow-context.tsx";

const nodeTypes = { construct: ConstructNode };

let nodeSeq = 0;

function CanvasInner() {
  const { nodes, edges, onNodesChange, onEdgesChange, setNodes, setEdges, setSelectedId } = useFlow();
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

  const onSelectionChange = useCallback(
    ({ nodes: sel }: { nodes: Node[] }) => setSelectedId(sel[0]?.id ?? null),
    [setSelectedId],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onSelectionChange={onSelectionChange}
      fitView
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={18} size={1.5} color="hsl(var(--canvas-dot))" />
      <Controls />
    </ReactFlow>
  );
}

export function Canvas() {
  const { activeFlowId } = useFlow();
  return (
    <ReactFlowProvider key={activeFlowId}>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
