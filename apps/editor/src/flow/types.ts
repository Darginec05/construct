import type { Resource } from "@construct/dsl";
import type { Edge, Node } from "reactflow";
import type { ConstructNodeData } from "./construct-node.tsx";

export type FlowNode = Node<ConstructNodeData>;
export type FlowKind = "main" | "sub";

export type RunStatus = "idle" | "running" | "completed" | "paused" | "failed";
export type NodeRunState = "running" | "done" | "error";
export type PublishStatus = "idle" | "publishing" | "done" | "error";
/** Where a Run executes: the in-browser fake sandbox, or a real self-host server. */
export type RunMode = "sandbox" | "server";

export interface PendingHuman {
  nodeId: string;
  exits: string[];
}

export interface FlowDoc {
  id: string;
  name: string;
  kind: FlowKind;
  parent?: string;
  nodes: FlowNode[];
  edges: Edge[];
  /** Declared external resources (sandbox, db, …). The editor has no authoring
   *  surface yet, but imported flows carry them so resource refs validate. */
  resources?: Resource[];
}
