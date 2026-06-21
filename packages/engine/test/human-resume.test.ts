import { SCHEMA_VERSION, type Flow } from "@construct/dsl";
import { describe, expect, it } from "vitest";
import { runFlow } from "../src/index.js";
import type { RunEvent } from "../src/types.js";

/**
 * Top-level human pause + resume: the engine pauses at a `human` node with a
 * descriptor the host can render, then a follow-up `runFlow` with `resume`
 * continues from the chosen handle WITHOUT re-executing the paused node.
 */

const flow: Flow = {
  schemaVersion: SCHEMA_VERSION,
  id: "review",
  name: "human gate",
  channels: [
    { name: "text", type: "text", reducer: "lastValue" },
    { name: "note", type: "text", reducer: "lastValue" },
  ],
  resources: [],
  nodes: [
    { id: "in", type: "input", config: { schema: { text: "text" } } },
    {
      id: "gate",
      type: "human",
      config: { mode: "approve", prompt: "Approve the draft?", writeTo: "note" },
    },
    { id: "ok", type: "output", config: { from: "$.note" } },
    { id: "no", type: "output", config: { from: "rejected" } },
  ],
  edges: [
    { id: "e1", source: "in", target: "gate" },
    { id: "e2", source: "gate", target: "ok", sourceHandle: "approved" },
    { id: "e3", source: "gate", target: "no", sourceHandle: "rejected" },
  ],
  config: {},
  metadata: {},
};

describe("human pause + resume", () => {
  it("pauses at the human node with a descriptor from its config", async () => {
    const res = await runFlow(flow, { input: { text: "hi" } });
    expect(res.status).toBe("paused");
    expect(res.pause).toEqual({
      nodeId: "gate",
      exits: ["approved", "rejected"],
      mode: "approve",
      prompt: "Approve the draft?",
      writeTo: "note",
    });
  });

  it("interpolates a {{channel}} token in the prompt against run state", async () => {
    const asking: Flow = {
      ...flow,
      nodes: flow.nodes.map((n) =>
        n.id === "gate" ? { ...n, config: { ...n.config, prompt: "Please clarify: {{text}}" } } : n,
      ),
    };
    const res = await runFlow(asking, { input: { text: "what budget?" } });
    expect(res.status).toBe("paused");
    expect(res.pause?.prompt).toBe("Please clarify: what budget?");
  });

  it("resumes down the chosen handle, applying the captured patch", async () => {
    const paused = await runFlow(flow, { input: { text: "hi" } });
    const events: RunEvent[] = [];
    const res = await runFlow(flow, {
      initialState: paused.state,
      resume: { nodeId: "gate", handle: "approved", patch: { note: "looks good" } },
      onEvent: (e) => events.push(e),
    });
    expect(res.status).toBe("completed");
    expect(res.state.note).toBe("looks good");
    expect(res.output).toBe("looks good");
    // The paused node is not re-run; only the downstream output node starts.
    const started = events.filter((e) => e.type === "node-start").map((e) => e.nodeId);
    expect(started).not.toContain("gate");
    expect(started).toContain("ok");
  });

  it("follows the rejected handle when that is chosen", async () => {
    const paused = await runFlow(flow, { input: { text: "hi" } });
    const res = await runFlow(flow, {
      initialState: paused.state,
      resume: { nodeId: "gate", handle: "rejected" },
    });
    expect(res.status).toBe("completed");
    expect(res.output).toBe("rejected");
  });

  it("fails when the resume target node does not exist", async () => {
    const res = await runFlow(flow, {
      resume: { nodeId: "ghost", handle: "approved" },
    });
    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/resume target "ghost" not found/);
  });
});
