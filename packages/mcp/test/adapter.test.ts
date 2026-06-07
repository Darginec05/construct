import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { getTool, needsApproval } from "@construct/tools";
import { z } from "zod";
import { beforeEach, describe, expect, it } from "vitest";
import { McpClient, registerMcpTools } from "../src/index.js";

/**
 * Integration: drive the adapter against a real (in-memory) MCP server so we
 * exercise the SDK's wire path, not a hand-rolled fake. The server exposes an
 * `echo` tool and a `boom` tool (an error result) so we can assert both the
 * happy path and that error results surface as thrown errors.
 */

function buildServer(): McpServer {
  const server = new McpServer({ name: "test-server", version: "0.0.0" });
  server.registerTool(
    "echo",
    {
      description: "Echo back the input text",
      inputSchema: { text: z.string() },
    },
    ({ text }) => ({ content: [{ type: "text" as const, text: `echo: ${text}` }] }),
  );
  server.registerTool(
    "boom",
    {
      description: "Always fails",
      inputSchema: {},
    },
    () => ({ content: [{ type: "text" as const, text: "kaboom" }], isError: true }),
  );
  server.registerTool(
    "lookup",
    {
      description: "Return a structured record",
      inputSchema: { id: z.string() },
      outputSchema: { id: z.string(), found: z.boolean() },
    },
    ({ id }) => {
      const structured = { id, found: true };
      return { content: [{ type: "text" as const, text: JSON.stringify(structured) }], structuredContent: structured };
    },
  );
  return server;
}

async function connectClient(): Promise<McpClient> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer();
  await server.connect(serverTransport);
  const client = new McpClient({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

describe("McpClient adapter", () => {
  let client: McpClient;

  beforeEach(async () => {
    client = await connectClient();
  });

  it("lists and maps tools (name, description, parameters)", async () => {
    const infos = await client.listTools();
    const echo = infos.find((t) => t.name === "echo")!;
    expect(echo).toBeDefined();
    expect(echo.description).toBe("Echo back the input text");
    expect(echo.inputSchema).toMatchObject({ type: "object" });
  });

  it("defaults unclassified tools to dangerous + requiresApproval", async () => {
    const tools = await client.toTools();
    const echo = tools.find((t) => t.name === "echo")!;
    expect(echo.tier).toBe("dangerous");
    expect(echo.requiresApproval).toBe(true);
    expect(needsApproval(echo)).toBe(true);
  });

  it("honors a tierFor classification", async () => {
    const tools = await client.toTools({
      tierFor: (t) => (t.name === "echo" ? "read" : undefined),
    });
    const echo = tools.find((t) => t.name === "echo")!;
    expect(echo.tier).toBe("read");
    expect(echo.requiresApproval).toBeUndefined();
    expect(needsApproval(echo)).toBe(false);
  });

  it("proxies run() to the MCP server and flattens text results", async () => {
    const tools = await client.toTools();
    const echo = tools.find((t) => t.name === "echo")!;
    await expect(echo.run({ text: "hi" })).resolves.toBe("echo: hi");
  });

  it("prefers structuredContent over text when present", async () => {
    const tools = await client.toTools();
    const lookup = tools.find((t) => t.name === "lookup")!;
    await expect(lookup.run({ id: "abc" })).resolves.toEqual({ id: "abc", found: true });
  });

  it("throws when the server returns an error result", async () => {
    const tools = await client.toTools();
    const boom = tools.find((t) => t.name === "boom")!;
    await expect(boom.run({})).rejects.toThrow("kaboom");
  });

  it("prefixes adapted tool names", async () => {
    const tools = await client.toTools({ prefix: "srv" });
    expect(tools.map((t) => t.name).sort()).toEqual(["srv_boom", "srv_echo", "srv_lookup"]);
  });

  it("registerMcpTools registers into the global registry", async () => {
    await registerMcpTools(client);
    expect(getTool("echo")).toBeDefined();
    expect(getTool("boom")).toBeDefined();
  });
});
