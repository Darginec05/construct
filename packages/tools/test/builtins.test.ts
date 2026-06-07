import { describe, expect, it, vi } from "vitest";
import {
  createHttpFetchTool,
  getTool,
  registerBuiltinTools,
  runTool,
  timeNow,
} from "../src/index.js";

describe("timeNow", () => {
  it("is a read-tier tool returning an ISO timestamp", async () => {
    expect(timeNow.tier).toBe("read");
    const result = await runTool(timeNow, {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.output).toBe("string");
      expect(new Date(result.output as string).toISOString()).toBe(result.output);
    }
  });
});

describe("createHttpFetchTool", () => {
  it("performs a GET via the injected fetch and shapes the result", async () => {
    const fakeFetch = vi.fn(async () =>
      new Response("hello", { status: 200 }),
    ) as unknown as typeof fetch;
    const tool = createHttpFetchTool(fakeFetch);
    expect(tool.tier).toBe("read");
    const result = await runTool(tool, { url: "https://example.com" });
    expect(result).toEqual({
      ok: true,
      output: { status: 200, ok: true, body: "hello" },
    });
  });

  it("rejects a non-URL input via schema validation", async () => {
    const tool = createHttpFetchTool((async () =>
      new Response("")) as unknown as typeof fetch);
    const result = await runTool(tool, { url: "not a url" });
    expect(result.ok).toBe(false);
  });
});

describe("registerBuiltinTools", () => {
  it("registers timeNow and a fetch tool when fetch is provided", () => {
    const fakeFetch = (async () => new Response("")) as unknown as typeof fetch;
    registerBuiltinTools({ fetch: fakeFetch });
    expect(getTool("time_now")).toBeDefined();
    expect(getTool("http_fetch")).toBeDefined();
  });
});
