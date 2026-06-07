import { z } from "zod";
import { defineTool, registerTool, type Tool } from "./index.js";

/**
 * A deliberately tiny set of safe, read-tier built-ins. These are NOT registered
 * automatically — a host opts in via {@link registerBuiltinTools} so the tool
 * surface stays explicit. Everything here is `tier: "read"`: no mutation, no
 * destructive side effects.
 */

/** Current wall-clock time as an ISO-8601 string. */
export const timeNow: Tool = defineTool({
  name: "time_now",
  description: "Return the current date and time as an ISO-8601 string (UTC).",
  tier: "read",
  run: () => new Date().toISOString(),
});

const HttpFetchInput = z.object({
  url: z.string().url().describe("Absolute http(s) URL to GET."),
  headers: z.record(z.string()).optional().describe("Optional request headers."),
});

/**
 * Build an HTTP GET tool. The `fetch` implementation is injected so the host
 * controls egress (allow-lists, proxies, test doubles); it defaults to the
 * global `fetch`. Read-tier: it only retrieves, never mutates.
 */
export function createHttpFetchTool(fetchImpl: typeof fetch = fetch): Tool {
  return defineTool({
    name: "http_fetch",
    description: "Fetch the body of an http(s) URL via GET.",
    tier: "read",
    input: HttpFetchInput,
    run: async ({ url, headers }) => {
      const res = await fetchImpl(url, { method: "GET", headers });
      const body = await res.text();
      return { status: res.status, ok: res.ok, body };
    },
  });
}

/**
 * Register the safe built-in tools into the global registry. Explicit by design.
 * Pass a custom `fetch` to control HTTP egress; omit `fetch` to skip the HTTP
 * tool entirely (e.g. in environments with no outbound network).
 */
export function registerBuiltinTools(options: { fetch?: typeof fetch } = {}): void {
  registerTool(timeNow);
  if (options.fetch) {
    registerTool(createHttpFetchTool(options.fetch));
  }
}
