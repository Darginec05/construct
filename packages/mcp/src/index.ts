import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  UnauthorizedError,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
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

export type { Transport, OAuthTokens, OAuthClientInformationMixed };

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
  /**
   * OAuth client provider for servers requiring user-delegated auth. When set, the
   * SDK transport drives the OAuth flow through it (discovery, attaching the access
   * token, refresh on 401). Leave unset for static-token / no-auth servers.
   */
  authProvider?: OAuthClientProvider;
  /** Identifies this client to the server. */
  client?: McpClientOptions;
}

/** A fetch that merges static headers into every request the transport makes. */
function headerInjectingFetch(headers: Record<string, string>): FetchLike {
  return (url, init) => fetch(url, { ...init, headers: { ...init?.headers, ...headers } });
}

/**
 * Build the concrete SDK transport for a config. Returns the concrete class (not
 * the `Transport` interface) so callers can reach `finishAuth`, which only the
 * concrete HTTP/SSE transports expose.
 */
function createConcreteTransport(
  config: McpConnectConfig,
): SSEClientTransport | StreamableHTTPClientTransport {
  const url = new URL(config.url);
  const fetchImpl = config.headers ? headerInjectingFetch(config.headers) : undefined;
  const authProvider = config.authProvider;
  if (config.transport === "sse") {
    return new SSEClientTransport(url, { fetch: fetchImpl, authProvider });
  }
  return new StreamableHTTPClientTransport(url, { fetch: fetchImpl, authProvider });
}

function createTransport(config: McpConnectConfig): Transport {
  return createConcreteTransport(config);
}

/**
 * Cap on a connect / OAuth handshake. A slow or hostile MCP server must never pin
 * a request — or a whole agent run — open indefinitely; on expiry we abort and
 * surface a clear error. Tuned generously: discovery + DCR can be several round-trips.
 */
const HANDSHAKE_TIMEOUT_MS = 30_000;

/** Thrown when {@link withHandshakeTimeout} fires; lets callers tell it apart. */
export class McpHandshakeTimeoutError extends Error {
  constructor(label: string) {
    super(`MCP ${label} timed out after ${HANDSHAKE_TIMEOUT_MS}ms`);
    this.name = "McpHandshakeTimeoutError";
  }
}

/**
 * Race a network handshake against {@link HANDSHAKE_TIMEOUT_MS}. On timeout we run
 * `onTimeout` (close the socket so it can't leak) and reject; `Promise.race` can't
 * cancel the underlying op, so releasing the transport is how we stop it pinning.
 */
async function withHandshakeTimeout<T>(
  op: Promise<T>,
  onTimeout: () => Promise<void>,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new McpHandshakeTimeoutError(label)), HANDSHAKE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([op, timeout]);
  } catch (err) {
    if (err instanceof McpHandshakeTimeoutError) await onTimeout().catch(() => undefined);
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Connect to a remote MCP server over http(s) and return a ready {@link McpClient}.
 * Keeps the MCP SDK's transport classes inside this package, so a host depends
 * only on Construct's surface. The caller owns the connection — `close()` it.
 */
export async function connectMcp(config: McpConnectConfig): Promise<McpClient> {
  const client = new McpClient(config.client);
  await withHandshakeTimeout(
    client.connect(createTransport(config)),
    () => client.close(),
    "connect",
  );
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

/**
 * The serializable state of one MCP OAuth authorization-code flow, owned by the
 * host. It is everything the SDK's `auth()` machinery would otherwise keep in
 * memory across the user-redirect boundary: the PKCE verifier, the dynamically
 * registered client, the cached discovery, and (after finish) the tokens. The
 * host persists this blob (encrypted) between {@link beginMcpOauth} and
 * {@link finishMcpOauth} and again for run-time refresh. Plain JSON by design.
 */
export interface McpOauthSession {
  /** Absolute callback URL registered as the OAuth `redirect_uri`. */
  redirectUri: string;
  /** Opaque CSRF nonce echoed as the OAuth `state` parameter. */
  state: string;
  /** PKCE code verifier generated at begin, needed to redeem the code. */
  codeVerifier?: string;
  /** Client credentials from dynamic registration (RFC 7591). */
  clientInformation?: OAuthClientInformationMixed;
  /** Cached RFC 9728 / RFC 8414 discovery, so finish skips re-discovery. */
  discoveryState?: OAuthDiscoveryState;
  /** Tokens from a successful exchange/refresh. */
  tokens?: OAuthTokens;
}

const OAUTH_CLIENT_NAME = "Construct Cloud";

/**
 * An {@link OAuthClientProvider} backed by a plain {@link McpOauthSession}, so the
 * SDK's stateful `auth()` flow can be paused at the user redirect and resumed in a
 * separate request. Construct registers as a public client (PKCE, no client
 * secret); `redirectToAuthorization` captures the URL instead of navigating.
 */
class StoredOAuthProvider implements OAuthClientProvider {
  /** Set when the SDK asks to redirect the user agent for consent. */
  authorizationUrl: string | undefined;
  private readonly session: McpOauthSession;
  private readonly onTokensRefreshed?: (tokens: OAuthTokens) => void | Promise<void>;

  constructor(
    session: McpOauthSession,
    onTokensRefreshed?: (tokens: OAuthTokens) => void | Promise<void>,
  ) {
    this.session = { ...session };
    this.onTokensRefreshed = onTokensRefreshed;
  }

  /** Current session blob, including anything the SDK saved during the flow. */
  snapshot(): McpOauthSession {
    return { ...this.session };
  }

  get redirectUrl(): string {
    return this.session.redirectUri;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: OAUTH_CLIENT_NAME,
      redirect_uris: [this.session.redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  state(): string {
    return this.session.state;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.session.clientInformation;
  }

  saveClientInformation(info: OAuthClientInformationMixed): void {
    this.session.clientInformation = info;
  }

  tokens(): OAuthTokens | undefined {
    return this.session.tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    this.session.tokens = tokens;
    // Fire-and-forget: the host persists refreshed tokens out of band. The SDK's
    // saveTokens is sync, so we don't await — a failed write only costs a refresh.
    void this.onTokensRefreshed?.(tokens);
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.authorizationUrl = authorizationUrl.toString();
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.session.codeVerifier = codeVerifier;
  }

  codeVerifier(): string {
    if (this.session.codeVerifier === undefined) {
      throw new Error("OAuth session is missing its PKCE code verifier");
    }
    return this.session.codeVerifier;
  }

  saveDiscoveryState(discoveryState: OAuthDiscoveryState): void {
    this.session.discoveryState = discoveryState;
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.session.discoveryState;
  }
}

export interface BeginMcpOauthResult {
  /** URL to send the user agent to for consent. */
  authorizationUrl: string;
  /** Session to persist; replay it into {@link finishMcpOauth}. */
  session: McpOauthSession;
}

/**
 * Start an MCP OAuth authorization-code flow. Connecting to a server that requires
 * user-delegated auth triggers the SDK's `auth()` (discovery → dynamic client
 * registration → PKCE), which asks to redirect the user and then throws
 * {@link UnauthorizedError}. We intercept the redirect to return its URL plus the
 * captured session; the host stores the session and sends the user to consent.
 */
export async function beginMcpOauth(
  config: McpConnectConfig,
  params: { redirectUri: string; state: string },
): Promise<BeginMcpOauthResult> {
  const provider = new StoredOAuthProvider({
    redirectUri: params.redirectUri,
    state: params.state,
  });
  const client = new McpClient(config.client);
  try {
    await withHandshakeTimeout(
      client.connect(createTransport({ ...config, authProvider: provider })),
      () => client.close(),
      "OAuth begin",
    );
    // The server accepted the connection without OAuth — nothing to authorize.
    await client.close().catch(() => undefined);
    throw new Error("MCP server did not require OAuth authorization");
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) throw err;
    if (provider.authorizationUrl === undefined) {
      throw new Error("OAuth flow did not produce an authorization URL");
    }
    return {
      authorizationUrl: provider.authorizationUrl,
      session: provider.snapshot(),
    };
  }
}

export interface FinishMcpOauthResult {
  /** Updated session (now carrying tokens); persist it for run-time refresh. */
  session: McpOauthSession;
  /** A live, authorized client — list tools, then `close()` it. */
  client: McpClient;
}

/**
 * Complete an MCP OAuth flow: replay the {@link McpOauthSession} from
 * {@link beginMcpOauth}, exchange the returned authorization code for tokens, and
 * return a connected client plus the token-bearing session. The provider reuses
 * the saved PKCE verifier, registered client, and discovery, so no step repeats.
 */
export async function finishMcpOauth(
  config: McpConnectConfig,
  params: { session: McpOauthSession; code: string },
): Promise<FinishMcpOauthResult> {
  const provider = new StoredOAuthProvider(params.session);
  const transport = createConcreteTransport({
    ...config,
    authProvider: provider,
  });
  await withHandshakeTimeout(
    transport.finishAuth(params.code),
    () => transport.close(),
    "OAuth token exchange",
  );
  const client = new McpClient(config.client);
  await withHandshakeTimeout(client.connect(transport), () => client.close(), "connect");
  return { session: provider.snapshot(), client };
}

/** Stored OAuth credentials a host replays to reconnect an authorized MCP server. */
export interface McpOauthCredentials {
  /** The callback URL registered as `redirect_uri`; must match the original grant. */
  redirectUri: string;
  /** Access/refresh tokens from the completed flow. */
  tokens: OAuthTokens;
  /** Client credentials from dynamic registration, needed to refresh. */
  clientInformation?: OAuthClientInformationMixed;
}

/**
 * Reconnect to an MCP server using previously stored OAuth tokens. Seeds a provider
 * from {@link McpOauthCredentials}; the SDK attaches the access token and, on a 401,
 * silently refreshes it. `onTokensRefreshed` is invoked whenever the SDK persists a
 * new token set so the host can write it back to its vault. The caller owns the
 * connection — `close()` it.
 */
export async function connectMcpWithOauth(
  config: McpConnectConfig,
  credentials: McpOauthCredentials,
  onTokensRefreshed: (tokens: OAuthTokens) => void | Promise<void>,
): Promise<McpClient> {
  const provider = new StoredOAuthProvider(
    {
      redirectUri: credentials.redirectUri,
      state: "",
      tokens: credentials.tokens,
      clientInformation: credentials.clientInformation,
    },
    onTokensRefreshed,
  );
  const client = new McpClient(config.client);
  await withHandshakeTimeout(
    client.connect(createTransport({ ...config, authProvider: provider })),
    () => client.close(),
    "connect",
  );
  return client;
}
