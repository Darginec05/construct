import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { SCHEMA_VERSION, type Flow } from "@construct/dsl";
import { runFlow, type ToolApprovalRequest } from "@construct/engine";
import { McpClient, registerMcpTools } from "@construct/mcp";
import { getTool } from "@construct/tools";
import "../dist/index.js"; // registers agent / classifier / tool / retrieve executors

/**
 * End-to-end: stand up a real (in-memory) MCP server, mount its tools into the
 * shared registry, then call them from a Flow's standalone `tool` node — proving
 * that an adapted MCP tool is indistinguishable from a native one and is subject
 * to the same tier gate.
 *
 * The server exposes two tools:
 *   - search_repos  → host classifies it `read` via `tierFor`  → auto-runs
 *   - create_issue  → left unclassified → defaults to dangerous + requiresApproval
 */
function buildServer(): McpServer {
  const server = new McpServer({ name: "github-ish", version: "0.0.0" });
  server.registerTool(
    "search_repos",
    { description: "Search repositories", inputSchema: { q: z.string() } },
    ({ q }) => ({ content: [{ type: "text" as const, text: `repos matching "${q}": acme/api, acme/web` }] }),
  );
  server.registerTool(
    "create_issue",
    {
      description: "Open an issue in a repository",
      inputSchema: { repo: z.string(), title: z.string() },
    },
    ({ repo, title }) => ({
      content: [{ type: "text" as const, text: `opened ${repo}#42: ${title}` }],
    }),
  );
  return server;
}

async function mountServer(): Promise<McpClient> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await buildServer().connect(serverTransport);
  const client = new McpClient({ name: "construct", version: "0.0.0" });
  await client.connect(clientTransport);

  // The host decides trust: search is read-only; everything else keeps the
  // conservative default (dangerous + requiresApproval).
  await registerMcpTools(client, {
    tierFor: (t) => (t.name === "search_repos" ? "read" : undefined),
  });
  return client;
}

/** A one-shot `tool` node that calls a registered tool and writes its result. */
function toolFlow(tool: string, args: Record<string, unknown>): Flow {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: `call-${tool}`,
    name: `call ${tool}`,
    channels: [{ name: "result", type: "text", reducer: "lastValue" }],
    resources: [],
    nodes: [
      { id: "in", type: "input", config: {} },
      { id: "call", type: "tool", config: { tool, args, writeTo: "result" } },
      { id: "out", type: "output", config: { from: "$.result" } },
    ],
    edges: [
      { id: "e1", source: "in", target: "call" },
      { id: "e2", source: "call", target: "out" },
    ],
    config: {},
    metadata: {},
  };
}

async function main(): Promise<void> {
  const client = await mountServer();

  // The adapted tools are now ordinary entries in the global registry.
  const created = getTool("create_issue")!;
  assert.equal(created.tier, "dangerous", "unclassified MCP tool defaults to dangerous");
  assert.equal(created.requiresApproval, true, "...and forces approval");
  assert.equal(getTool("search_repos")!.tier, "read", "tierFor downgraded search to read");

  // 1) read-tier tool auto-runs, no approver needed.
  const search = await runFlow(toolFlow("search_repos", { q: "acme" }), { input: {} });
  assert.equal(search.status, "completed");
  assert.match(String(search.output), /acme\/api/, "search proxied to the MCP server");

  // 2) dangerous tool with NO approver → fail-safe deny → node fails.
  const denied = await runFlow(toolFlow("create_issue", { repo: "acme/api", title: "bug" }), {
    input: {},
  });
  assert.equal(denied.status, "failed", "no approver → denied");
  assert.match(String(denied.error), /no approver configured/);

  // 3) same call, now with an approver that says yes → tool runs on the server.
  const requests: ToolApprovalRequest[] = [];
  const approved = await runFlow(toolFlow("create_issue", { repo: "acme/api", title: "bug" }), {
    input: {},
    onToolApproval: (req) => {
      requests.push(req);
      return { approved: true };
    },
  });
  assert.equal(approved.status, "completed");
  assert.equal(approved.output, "opened acme/api#42: bug", "approved call hit the MCP server");
  assert.deepEqual(requests, [
    {
      nodeId: "call",
      tool: "create_issue",
      tier: "dangerous",
      args: { repo: "acme/api", title: "bug" },
    },
  ]);

  await client.close();

  console.log("mcp-flow example: all assertions passed");
  console.log("  search  ->", search.output);
  console.log("  denied  ->", denied.error);
  console.log("  created ->", approved.output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
