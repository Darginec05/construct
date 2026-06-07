import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toJsonSchema } from "../src/schema.js";

describe("toJsonSchema", () => {
  it("maps scalar leaf types", () => {
    expect(toJsonSchema(z.string())).toEqual({ type: "string" });
    expect(toJsonSchema(z.number())).toEqual({ type: "number" });
    expect(toJsonSchema(z.boolean())).toEqual({ type: "boolean" });
  });

  it("carries descriptions", () => {
    expect(toJsonSchema(z.string().describe("a name"))).toEqual({
      type: "string",
      description: "a name",
    });
  });

  it("emits const for literals and enum for enums", () => {
    expect(toJsonSchema(z.literal("go"))).toEqual({ const: "go" });
    expect(toJsonSchema(z.enum(["a", "b"]))).toEqual({
      type: "string",
      enum: ["a", "b"],
    });
  });

  it("recurses into arrays", () => {
    expect(toJsonSchema(z.array(z.number()))).toEqual({
      type: "array",
      items: { type: "number" },
    });
  });

  it("builds objects with required derived from optionality", () => {
    const schema = z.object({
      url: z.string().url(),
      headers: z.record(z.string()).optional(),
      topK: z.number().default(5),
    });
    const json = toJsonSchema(schema);
    expect(json.type).toBe("object");
    expect(json.required).toEqual(["url"]);
    const props = json.properties as Record<string, unknown>;
    expect(props.url).toEqual({ type: "string" });
    expect(props.topK).toEqual({ type: "number" });
  });

  it("unwraps optional/default/nullable but keeps wrapper descriptions", () => {
    expect(toJsonSchema(z.string().optional().describe("maybe"))).toEqual({
      type: "string",
      description: "maybe",
    });
  });

  it("falls back to an open value for unknown shapes", () => {
    expect(toJsonSchema(z.unknown())).toEqual({});
  });
});
