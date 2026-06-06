import { describe, expect, it } from "vitest";
import {
  BudgetSchema,
  ChannelSchema,
  DataTypeSchema,
  ModelRefSchema,
  ReducerSchema,
  ResourceSchema,
} from "../src/index.js";

describe("DataTypeSchema", () => {
  it("accepts the supported multimodal types", () => {
    for (const t of ["text", "image", "file", "audio", "json", "any"]) {
      expect(DataTypeSchema.parse(t)).toBe(t);
    }
  });

  it("rejects unknown types", () => {
    expect(DataTypeSchema.safeParse("video").success).toBe(false);
  });
});

describe("ReducerSchema", () => {
  it("accepts the three reducers", () => {
    expect(ReducerSchema.parse("lastValue")).toBe("lastValue");
    expect(ReducerSchema.parse("append")).toBe("append");
    expect(ReducerSchema.parse("merge")).toBe("merge");
  });

  it("rejects unknown reducers", () => {
    expect(ReducerSchema.safeParse("sum").success).toBe(false);
  });
});

describe("ChannelSchema", () => {
  it("applies defaults for type and reducer", () => {
    const ch = ChannelSchema.parse({ name: "messages" });
    expect(ch.type).toBe("any");
    expect(ch.reducer).toBe("lastValue");
    expect(ch.initial).toBeUndefined();
  });

  it("keeps explicit values", () => {
    const ch = ChannelSchema.parse({
      name: "history",
      type: "json",
      reducer: "append",
      initial: [],
    });
    expect(ch).toMatchObject({
      name: "history",
      type: "json",
      reducer: "append",
      initial: [],
    });
  });

  it("requires a name", () => {
    expect(ChannelSchema.safeParse({}).success).toBe(false);
  });
});

describe("ModelRefSchema", () => {
  it("requires provider and model", () => {
    expect(
      ModelRefSchema.safeParse({ provider: "anthropic", model: "x" }).success,
    ).toBe(true);
    expect(ModelRefSchema.safeParse({ provider: "anthropic" }).success).toBe(
      false,
    );
  });

  it("bounds temperature to [0, 2]", () => {
    const base = { provider: "anthropic", model: "x" };
    expect(ModelRefSchema.safeParse({ ...base, temperature: 2 }).success).toBe(
      true,
    );
    expect(
      ModelRefSchema.safeParse({ ...base, temperature: 2.5 }).success,
    ).toBe(false);
    expect(ModelRefSchema.safeParse({ ...base, temperature: -1 }).success).toBe(
      false,
    );
  });
});

describe("BudgetSchema", () => {
  it("accepts an empty budget", () => {
    expect(BudgetSchema.parse({})).toEqual({});
  });

  it("rejects non-positive limits", () => {
    expect(BudgetSchema.safeParse({ maxUsd: 0 }).success).toBe(false);
    expect(BudgetSchema.safeParse({ maxTokens: -10 }).success).toBe(false);
  });
});

describe("ResourceSchema", () => {
  it("defaults scope to run and config to {}", () => {
    const r = ResourceSchema.parse({ name: "db", kind: "db" });
    expect(r.scope).toBe("run");
    expect(r.config).toEqual({});
  });

  it("rejects an unknown scope", () => {
    expect(
      ResourceSchema.safeParse({ name: "db", kind: "db", scope: "global" })
        .success,
    ).toBe(false);
  });
});
