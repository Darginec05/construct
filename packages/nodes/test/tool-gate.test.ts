import { SCHEMA_VERSION, type Flow } from "@construct/dsl";
import { runFlow, type ToolApprovalRequest } from "@construct/engine";
import { defineTool, registerTool } from "@construct/tools";
import { beforeEach, describe, expect, it } from "vitest";
// Importing the package registers the real `tool` executor we want to exercise.
import "../src/index.js";

/**
 * Integration: the standalone `tool` node must gate write/bulk/dangerous tools
 * through the engine's approval callback and fail safe (fail the node) when no
 * approver is wired — there's no model to recover from a denial here.
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

function buildFlow(tool: string, extra: Record<string, unknown> = {}): Flow {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "gate-tool",
    name: "gate tool",
    channels: [{ name: "result", type: "text", reducer: "lastValue" }],
    resources: [],
    nodes: [
      { id: "in", type: "input", config: { schema: {} } },
      {
        id: "tool",
        type: "tool",
        config: { tool, args: { name: "x" }, writeTo: "result", ...extra },
      },
      { id: "out", type: "output", config: { from: "$.result" } },
    ],
    edges: [
      { id: "e1", source: "in", target: "tool" },
      { id: "e2", source: "tool", target: "out" },
    ],
    config: {},
    metadata: {},
  };
}

describe("tool node tier gate", () => {
  beforeEach(() => {
    ran = [];
  });

  it("fails the node when a dangerous tool has no approver", async () => {
    registerDangerTool();

    const res = await runFlow(buildFlow("delete_repo"), { input: {} });

    expect(res.status).toBe("failed");
    expect(res.error).toContain("was not approved");
    expect(res.error).toContain("no approver configured");
    expect(ran).toEqual([]);
  });

  it("runs a dangerous tool once approved", async () => {
    registerDangerTool();
    const requests: ToolApprovalRequest[] = [];

    const res = await runFlow(buildFlow("delete_repo"), {
      input: {},
      onToolApproval: (req) => {
        requests.push(req);
        return { approved: true };
      },
    });

    expect(res.status).toBe("completed");
    expect(res.output).toBe("deleted");
    expect(ran).toEqual([{ name: "delete_repo", args: { name: "x" } }]);
    expect(requests).toEqual([
      { nodeId: "tool", tool: "delete_repo", tier: "dangerous", args: { name: "x" } },
    ]);
  });

  it("fails with the rejection reason", async () => {
    registerDangerTool();

    const res = await runFlow(buildFlow("delete_repo"), {
      input: {},
      onToolApproval: () => ({ approved: false, reason: "policy denies prod deletes" }),
    });

    expect(res.status).toBe("failed");
    expect(res.error).toContain("policy denies prod deletes");
    expect(ran).toEqual([]);
  });

  it("auto-runs a read-tier tool without an approver", async () => {
    registerReadTool();

    const res = await runFlow(buildFlow("list_repos"), { input: {} });

    expect(res.status).toBe("completed");
    expect(res.output).toBe("repo-a, repo-b");
    expect(ran).toEqual([{ name: "list_repos", args: { name: "x" } }]);
  });

  it("does not consult the approver for a non-gated tool", async () => {
    registerReadTool();
    let approverCalls = 0;

    const res = await runFlow(buildFlow("list_repos"), {
      input: {},
      onToolApproval: () => {
        approverCalls++;
        return { approved: false };
      },
    });

    expect(res.status).toBe("completed");
    expect(approverCalls).toBe(0);
    expect(ran).toEqual([{ name: "list_repos", args: { name: "x" } }]);
  });

  it("gates a read tool when the node config requires approval", async () => {
    registerReadTool();

    const res = await runFlow(buildFlow("list_repos", { requiresApproval: true }), {
      input: {},
    });

    expect(res.status).toBe("failed");
    expect(res.error).toContain("was not approved");
    expect(ran).toEqual([]);
  });

  it("escalates a read tool to a gated tier set on the node config", async () => {
    registerReadTool();
    const requests: ToolApprovalRequest[] = [];

    const res = await runFlow(buildFlow("list_repos", { tier: "dangerous" }), {
      input: {},
      onToolApproval: (req) => {
        requests.push(req);
        return { approved: true };
      },
    });

    expect(res.status).toBe("completed");
    expect(requests).toEqual([
      { nodeId: "tool", tool: "list_repos", tier: "dangerous", args: { name: "x" } },
    ]);
  });

  it("still gates a dangerous tool when the node config tries to relax it", async () => {
    registerDangerTool();

    const res = await runFlow(
      buildFlow("delete_repo", { tier: "read", requiresApproval: false }),
      { input: {} },
    );

    expect(res.status).toBe("failed");
    expect(res.error).toContain("was not approved");
    expect(ran).toEqual([]);
  });
});
