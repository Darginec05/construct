import { SCHEMA_VERSION, type Flow } from "@construct/dsl";
import { runFlow, type ToolApprovalRequest } from "@construct/engine";
import { createFakeProvider, registerProvider } from "@construct/providers";
import { defineTool, registerTool } from "@construct/tools";
import { beforeEach, describe, expect, it } from "vitest";
// Importing the package registers the real `agent` executor we want to exercise.
import "../src/index.js";

/**
 * Integration: the shipped `agent` executor must gate write/bulk/dangerous tools
 * through the engine's approval callback, fail safe when no approver is wired,
 * and feed a rejection back to the model as a `tool` message (not abort the run).
 */

let ran: { name: string; args: unknown }[] = [];

function registerDangerTool(): void {
  registerTool(
    defineTool({
      name: "delete_repo",
      description: "Delete a repository",
      tier: "dangerous",
      run: (args) => {
        ran.push({ name: "delete_repo", args });
        return "deleted";
      },
    }),
  );
}

function registerReadTool(): void {
  registerTool(
    defineTool({
      name: "list_repos",
      description: "List repositories",
      tier: "read",
      run: (args) => {
        ran.push({ name: "list_repos", args });
        return "repo-a, repo-b";
      },
    }),
  );
}

function buildFlow(tool: string): Flow {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "gate-agent",
    name: "gate agent",
    channels: [{ name: "answer", type: "text", reducer: "lastValue" }],
    resources: [],
    nodes: [
      { id: "in", type: "input", config: { schema: {} } },
      {
        id: "agent",
        type: "agent",
        config: {
          model: { provider: "fake", model: "m" },
          prompt: "go",
          tools: [tool],
          toolChoice: "auto",
          writeTo: "answer",
        },
      },
      { id: "out", type: "output", config: { from: "$.answer" } },
    ],
    edges: [
      { id: "e1", source: "in", target: "agent" },
      { id: "e2", source: "agent", target: "out" },
    ],
    config: {},
    metadata: {},
  };
}

/** A two-turn script: ask for `tool`, then capture the tool-result message. */
function scriptCallingTool(tool: string, captured: { content?: string }) {
  return createFakeProvider({
    id: "fake",
    script: [
      {
        text: "",
        toolCalls: [{ id: "c1", name: tool, arguments: { name: "x" } }],
        stopReason: "tool_use",
      },
      (messages) => {
        const last = messages.at(-1)!;
        captured.content = String(last.content);
        return { text: "ok", stopReason: "end_turn" };
      },
    ],
  });
}

describe("agent tier gate", () => {
  beforeEach(() => {
    ran = [];
  });

  it("denies a dangerous tool when no approver is configured", async () => {
    registerDangerTool();
    const captured: { content?: string } = {};
    registerProvider(scriptCallingTool("delete_repo", captured));

    const res = await runFlow(buildFlow("delete_repo"), { input: {} });

    expect(res.status).toBe("completed");
    expect(ran).toEqual([]); // the tool never ran
    expect(captured.content).toContain("was not approved");
    expect(captured.content).toContain("no approver configured");
  });

  it("runs a dangerous tool once approved", async () => {
    registerDangerTool();
    const captured: { content?: string } = {};
    registerProvider(scriptCallingTool("delete_repo", captured));
    const requests: ToolApprovalRequest[] = [];

    const res = await runFlow(buildFlow("delete_repo"), {
      input: {},
      onToolApproval: (req) => {
        requests.push(req);
        return { approved: true };
      },
    });

    expect(res.status).toBe("completed");
    expect(ran).toEqual([{ name: "delete_repo", args: { name: "x" } }]);
    expect(captured.content).toBe("deleted");
    expect(requests).toEqual([
      { nodeId: "agent", tool: "delete_repo", tier: "dangerous", args: { name: "x" } },
    ]);
  });

  it("rejects with a reason fed back to the model", async () => {
    registerDangerTool();
    const captured: { content?: string } = {};
    registerProvider(scriptCallingTool("delete_repo", captured));

    const res = await runFlow(buildFlow("delete_repo"), {
      input: {},
      onToolApproval: () => ({ approved: false, reason: "policy denies prod deletes" }),
    });

    expect(res.status).toBe("completed");
    expect(ran).toEqual([]);
    expect(captured.content).toContain("was not approved");
    expect(captured.content).toContain("policy denies prod deletes");
  });

  it("auto-runs a read-tier tool without an approver", async () => {
    registerReadTool();
    const captured: { content?: string } = {};
    registerProvider(scriptCallingTool("list_repos", captured));

    const res = await runFlow(buildFlow("list_repos"), { input: {} });

    expect(res.status).toBe("completed");
    expect(ran).toEqual([{ name: "list_repos", args: { name: "x" } }]);
    expect(captured.content).toBe("repo-a, repo-b");
  });

  it("does not consult the approver for a non-gated tool", async () => {
    registerReadTool();
    const captured: { content?: string } = {};
    registerProvider(scriptCallingTool("list_repos", captured));
    let approverCalls = 0;

    const res = await runFlow(buildFlow("list_repos"), {
      input: {},
      onToolApproval: () => {
        approverCalls++;
        return { approved: false };
      },
    });

    expect(res.status).toBe("completed");
    expect(approverCalls).toBe(0); // read-tier never asks
    expect(ran).toEqual([{ name: "list_repos", args: { name: "x" } }]);
  });
});
