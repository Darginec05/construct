import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FetchLike, Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { registerTool, type Tool, type ToolTier } from "@construct/tools";

/**
 * @construct/mcp — mount any MCP server's tools into Construct's tool registry.
 *
 * The adapter is deliberately thin: it wraps the official MCP SDK client, lists
 * a server's tools, and turns each into a Construct {@link Tool} (its JSON Schema
 * `inputSchema` becomes `parameters`, `run` proxies to the MCP call). Connections
 * are host-side and explicit (connect → use → close); the engine never opens one.
 *
 * Safety: MCP tools arrive with no tier. An unclassified tool defaults to
 * `dangerous` + `requiresApproval`, so the agent loop's tier gate forces human
 * approval before a third-party write tool can run. A host that trusts a server
 * classifies tools via {@link AdaptOptions.tierFor}.
 */

export type { Transport };

/** A tool as advertised by an MCP server. */
export interface McpToolInfo {
  name: string;
  description?: string;
  /** JSON Schema for the tool's input ({ type: "object", ... }). */
  inputSchema: Record<string, unknown>;
  /** Advisory hints from the (untrusted) server; never auto-downgrades tier. */
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export interface AdaptOptions {
  /**
   * Prefix joined with `_` to namespace tool names (e.g. "github" →
   * "github_create_issue"), avoiding collisions across mounted servers. Names
   * must stay model-safe ([A-Za-z0-9_-]); the prefix is not sanitized for you.
   */
  prefix?: string;
  /**
   * Classify a tool's safety tier. Return a tier to override the conservative
   * default; return undefined to keep `dangerous` + forced approval. Receives
   * the tool's annotations so a trusting host can honor `readOnlyHint`.
   */
  tierFor?: (tool: McpToolInfo) => ToolTier | undefined;
}

export interface McpClientOptions {
  name?: string;
  version?: string;
}

/** Wire transport used to reach a remote MCP server over http(s). */
export type McpTransportKind = "http" | "sse";

export interface McpConnectConfig {
  /** Absolute http(s) URL of the MCP server endpoint. */
  url: string;
  /** "http" = Streamable HTTP (preferred); "sse" = legacy Server-Sent Events. */
  transport: McpTransportKind;
  /** Static headers sent on every request (e.g. an Authorization bearer token). */
  headers?: Record<string, string>;
  /** Identifies this client to the server. */
  client?: McpClientOptions;
}

/** A fetch that merges static headers into every request the transport makes. */
function headerInjectingFetch(headers: Record<string, string>): FetchLike {
  return (url, init) => fetch(url, { ...init, headers: { ...init?.headers, ...headers } });
}

function createTransport(config: McpConnectConfig): Transport {
  const url = new URL(config.url);
  const fetchImpl = config.headers ? headerInjectingFetch(config.headers) : undefined;
  if (config.transport === "sse") {
    return new SSEClientTransport(url, { fetch: fetchImpl });
  }
  return new StreamableHTTPClientTransport(url, { fetch: fetchImpl });
}

/**
 * Connect to a remote MCP server over http(s) and return a ready {@link McpClient}.
 * Keeps the MCP SDK's transport classes inside this package, so a host depends
 * only on Construct's surface. The caller owns the connection — `close()` it.
 */
export async function connectMcp(config: McpConnectConfig): Promise<McpClient> {
  const client = new McpClient(config.client);
  await client.connect(createTransport(config));
  return client;
}

/**
 * A connected MCP server, adapted to Construct's tool model. One instance wraps
 * one server connection; pass any MCP SDK {@link Transport} to {@link connect}.
 */
export class McpClient {
  private readonly client: Client;

  constructor(options: McpClientOptions = {}) {
    this.client = new Client({
      name: options.name ?? "construct",
      version: options.version ?? "0.0.0",
    });
  }

  async connect(transport: Transport): Promise<void> {
    await this.client.connect(transport);
  }

  async listTools(): Promise<McpToolInfo[]> {
    const { tools } = await this.client.listTools();
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: t.annotations,
    }));
  }

  /** Invoke a tool by its MCP name and reduce the result to a plain value. */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const res = await this.client.callTool({ name, arguments: args });
    return flattenResult(res as CallToolResultLike);
  }

  /** Adapt every tool the server exposes into Construct {@link Tool}s. */
  async toTools(options: AdaptOptions = {}): Promise<Tool[]> {
    const infos = await this.listTools();
    return infos.map((info) => this.adapt(info, options));
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  private adapt(info: McpToolInfo, options: AdaptOptions): Tool {
    const classified = options.tierFor?.(info);
    const tier: ToolTier = classified ?? "dangerous";
    const name = options.prefix ? `${options.prefix}_${info.name}` : info.name;
    return {
      name,
      description: info.description ?? "",
      parameters: info.inputSchema,
      tier,
      // An unclassified third-party tool forces approval regardless of tier.
      requiresApproval: classified === undefined ? true : undefined,
      run: (input) => this.callTool(info.name, asArgs(input)),
    };
  }
}

/**
 * Adapt and register every tool a connected client exposes into the global tool
 * registry. Returns the adapted tools.
 */
export async function registerMcpTools(
  client: McpClient,
  options: AdaptOptions = {},
): Promise<Tool[]> {
  const tools = await client.toTools(options);
  for (const tool of tools) registerTool(tool);
  return tools;
}

function asArgs(input: unknown): Record<string, unknown> {
  return input !==null && typeof input === "object"
    ? (input as Record<string, unknown>)
    : {};
}

interface CallToolResultLike {
  content?: { type: string; text?: string }[];
  structuredContent?: unknown;
  isError?: boolean;
}

/**
 * Reduce an MCP CallTool result to a plain value. An error result throws (so the
 * caller's `runTool` wraps it as a tool-message error rather than aborting the
 * run); structured content is returned as-is; otherwise text parts are joined.
 */
function flattenResult(res: CallToolResultLike): unknown {
  const text = (res.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
  if (res.isError) throw new Error(text || "MCP tool returned an error");
  if (res.structuredContent !== undefined) return res.structuredContent;
  return text !== "" ? text : (res.content ?? []);
}
