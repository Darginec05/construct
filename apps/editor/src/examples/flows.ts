import type { WorkspaceFlowInput } from "@construct/editor";

export const INITIAL_FLOWS: WorkspaceFlowInput[] = [
  {
    kind: "main",
    flow: {
      id: "main",
      name: "Assistant",
      nodes: [
        { id: "in", type: "input", config: { schema: { message: "text" } }, position: { x: 0, y: 120 } },
        {
          id: "ag",
          type: "agent",
          config: {
            model: { provider: "anthropic", model: "claude-sonnet-4-6" },
            prompt: "{{ $.message }}",
            writeTo: "reply",
          },
          position: { x: 320, y: 120 },
        },
        { id: "out", type: "output", config: { from: "$.reply" }, position: { x: 640, y: 120 } },
      ],
      edges: [
        { id: "e1", source: "in", target: "ag" },
        { id: "e2", source: "ag", target: "out" },
      ],
    },
  },
  {
    kind: "sub",
    parent: "main",
    flow: {
      id: "reviewer",
      name: "Reviewer",
      nodes: [
        { id: "r-in", type: "input", config: { schema: { draft: "text" } }, position: { x: 0, y: 120 } },
        {
          id: "r-ag",
          type: "agent",
          config: {
            model: { provider: "anthropic", model: "claude-sonnet-4-6" },
            prompt: "{{ $.draft }}",
            writeTo: "review",
          },
          position: { x: 320, y: 120 },
        },
        { id: "r-out", type: "output", config: { from: "$.review" }, position: { x: 640, y: 120 } },
      ],
      edges: [
        { id: "re1", source: "r-in", target: "r-ag" },
        { id: "re2", source: "r-ag", target: "r-out" },
      ],
    },
  },
];
