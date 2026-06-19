import { describe, expect, it } from "vitest";
import { anthropic, gemini, openai, provider } from "../src/model.js";

describe("model helpers", () => {
  it("anthropic builds a minimal ModelRef", () => {
    expect(anthropic("claude-sonnet-4-6")).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
    });
  });

  it("openai and gemini set the provider id", () => {
    expect(openai("gpt-4o").provider).toBe("openai");
    expect(gemini("gemini-2.0-flash").provider).toBe("gemini");
  });

  it("provider accepts arbitrary provider ids", () => {
    expect(provider("local", "llama-3")).toEqual({
      provider: "local",
      model: "llama-3",
    });
  });

  it("forwards optional tuning fields", () => {
    expect(
      anthropic("claude-haiku-4-5", {
        temperature: 0.2,
        maxTokens: 4096,
        cache: true,
        params: { top_p: 0.9 },
      }),
    ).toEqual({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      temperature: 0.2,
      maxTokens: 4096,
      cache: true,
      params: { top_p: 0.9 },
    });
  });

  it("omits undefined options from the ref", () => {
    expect(Object.keys(openai("gpt-4o-mini"))).toEqual(["provider", "model"]);
  });
});
