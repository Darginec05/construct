import { describe, expect, it } from "vitest";
import {
  type ExprToken,
  expressionRefs,
  serializeExpr,
  tokenizeExpr,
  variableRef,
} from "../src/index.js";

const refs = (tokens: ExprToken[]) => tokens.filter((t) => t.kind === "ref");

describe("tokenizeExpr — whole-string dollar reference", () => {
  it("parses `$.message` as a single raw reference", () => {
    const tokens = tokenizeExpr("$.message");
    expect(tokens).toEqual([
      { kind: "ref", form: "dollar", name: "message", path: "message", raw: "$.message" },
    ]);
  });

  it("keeps the root name for a deep path", () => {
    const [ref] = refs(tokenizeExpr("$.result.targetId"));
    expect(ref).toMatchObject({ name: "result", path: "result.targetId" });
  });

  it("treats a bare literal as a single literal token", () => {
    expect(tokenizeExpr("just text")).toEqual([{ kind: "literal", text: "just text" }]);
  });
});

describe("tokenizeExpr — interpolation", () => {
  it("splits literal text around `{{ }}` segments", () => {
    const tokens = tokenizeExpr("Hello {{name}}!");
    expect(tokens).toEqual([
      { kind: "literal", text: "Hello " },
      { kind: "ref", form: "braces", name: "name", path: "name", raw: "{{name}}" },
      { kind: "literal", text: "!" },
    ]);
  });

  it("handles multiple references and inner padding / $. prefix", () => {
    const names = refs(tokenizeExpr("{{ user.id }} and {{$.message}}")).map((t) => t.name);
    expect(names).toEqual(["user", "message"]);
  });
});

describe("serializeExpr — round-trip", () => {
  it.each([
    "$.message",
    "$.result.targetId",
    "Hello {{name}}, id {{ user.id }}",
    "plain literal",
    "{{a}}{{b}}",
    "  $.padded  ",
  ])("round-trips %j losslessly", (src) => {
    expect(serializeExpr(tokenizeExpr(src))).toBe(src);
  });
});

describe("expressionRefs + variableRef", () => {
  it("returns distinct root names", () => {
    expect(expressionRefs("{{a}} {{a.b}} {{c}}")).toEqual(["a", "c"]);
  });

  it("builds the canonical reference form", () => {
    expect(variableRef("msg", "dollar")).toBe("$.msg");
    expect(variableRef("msg", "braces")).toBe("{{msg}}");
  });
});
