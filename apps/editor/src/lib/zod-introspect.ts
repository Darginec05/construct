import type { z } from "zod";

export type FieldKind =
  | "text"
  | "textarea"
  | "number"
  | "boolean"
  | "enum"
  | "string-list"
  | "model"
  | "record"
  | "object"
  | "union"
  | "json";

export interface FieldSpec {
  key: string;
  kind: FieldKind;
  optional: boolean;
  default: unknown;
  /** Enum values, or a record's enum value options. */
  options: readonly string[];
  /** Render the text/textarea control monospace (expressions / code). */
  mono?: boolean;
  /** A string field that references another flow's id. */
  ref?: "flow";
  /** Numeric bounds, when the schema declares them. */
  min?: number;
  max?: number;
  int?: boolean;
  /** For `record` kind: how each value is edited. */
  recordValue?: "datatype" | "expr" | "unknown";
  /** For `object` kind: the nested scalar fields. */
  fields?: FieldSpec[];
  /** For `union` kind: which union shape this is. */
  union?: "expr-or-record" | "text-or-structured" | "other";
}

// zod v3 internals are untyped here; navigate via a loose alias.
type AnyDef = { typeName: string; [k: string]: unknown };
type AnyZod = { _def: AnyDef };

/** Multi-line free text. */
const MULTILINE_KEYS = new Set(["system", "prompt", "inline"]);
/** Multi-line fields that hold source code (monospace). */
const CODE_KEYS = new Set(["inline"]);
/** Single-line expression fields rendered monospace. */
const EXPR_KEYS = new Set(["expr", "condition", "query", "over", "until", "on"]);
/** String fields that point at a sub-flow id. */
const FLOW_REF_KEYS = new Set(["body", "flow"]);

/** Strip ZodEffects (refine/transform) wrappers to reach the inner schema. */
function unwrapEffects(schema: AnyZod): AnyZod {
  let s = schema;
  while (s._def.typeName === "ZodEffects") {
    s = s._def.schema as AnyZod;
  }
  return s;
}

interface Peeled {
  core: AnyZod;
  optional: boolean;
  default: unknown;
}

/** Remove Optional/Default/Nullable/Effects layers, capturing a default if present. */
function peel(field: AnyZod): Peeled {
  let core = field;
  let optional = false;
  let dflt: unknown = undefined;
  for (;;) {
    const tn = core._def.typeName;
    if (tn === "ZodOptional" || tn === "ZodNullable") {
      optional = true;
      core = core._def.innerType as AnyZod;
    } else if (tn === "ZodDefault") {
      const make = core._def.defaultValue as () => unknown;
      dflt = make();
      core = core._def.innerType as AnyZod;
    } else if (tn === "ZodEffects") {
      core = core._def.schema as AnyZod;
    } else {
      break;
    }
  }
  return { core, optional, default: dflt };
}

interface KindInfo {
  kind: FieldKind;
  options: readonly string[];
  mono?: boolean;
  ref?: "flow";
  min?: number;
  max?: number;
  int?: boolean;
  recordValue?: "datatype" | "expr" | "unknown";
  fields?: FieldSpec[];
  union?: "expr-or-record" | "text-or-structured" | "other";
}

const SCALAR_KINDS = new Set<FieldKind>(["text", "textarea", "number", "boolean", "enum"]);

function numberBounds(core: AnyZod): { min?: number; max?: number; int?: boolean } {
  const checks = (core._def.checks as { kind: string; value?: number; inclusive?: boolean }[]) ?? [];
  const int = checks.some((c) => c.kind === "int");
  const minCheck = checks.find((c) => c.kind === "min");
  const maxCheck = checks.find((c) => c.kind === "max");
  let min: number | undefined;
  let max: number | undefined;
  if (minCheck && typeof minCheck.value === "number") {
    min = minCheck.inclusive ? minCheck.value : minCheck.value + (int ? 1 : 0);
  }
  if (maxCheck && typeof maxCheck.value === "number") {
    max = maxCheck.inclusive ? maxCheck.value : maxCheck.value - (int ? 1 : 0);
  }
  return { min, max, int };
}

function objectInfo(core: AnyZod): KindInfo {
  const shape = (core._def.shape as () => Record<string, AnyZod>)();
  if ("provider" in shape && "model" in shape) return { kind: "model", options: [] };
  const fields = Object.entries(shape).map(([k, f]) => describeField(k, f));
  if (fields.every((f) => SCALAR_KINDS.has(f.kind))) {
    return { kind: "object", options: [], fields };
  }
  return { kind: "json", options: [] };
}

function recordInfo(core: AnyZod): KindInfo {
  const value = peel(core._def.valueType as AnyZod).core;
  const vtn = value._def.typeName;
  if (vtn === "ZodEnum") {
    return { kind: "record", options: value._def.values as string[], recordValue: "datatype" };
  }
  if (vtn === "ZodString") return { kind: "record", options: [], recordValue: "expr" };
  return { kind: "record", options: [], recordValue: "unknown" };
}

function unionInfo(core: AnyZod): KindInfo {
  const opts = (core._def.options as AnyZod[]).map((o) => o._def.typeName);
  if (opts.includes("ZodLiteral") && opts.includes("ZodObject")) {
    return { kind: "union", options: [], union: "text-or-structured" };
  }
  if (opts.includes("ZodString") && opts.includes("ZodRecord")) {
    return { kind: "union", options: [], union: "expr-or-record" };
  }
  return { kind: "json", options: [] };
}

function kindOf(key: string, core: AnyZod): KindInfo {
  const tn = core._def.typeName;
  switch (tn) {
    case "ZodString":
      if (MULTILINE_KEYS.has(key)) return { kind: "textarea", options: [], mono: CODE_KEYS.has(key) };
      if (FLOW_REF_KEYS.has(key)) return { kind: "text", options: [], ref: "flow" };
      if (EXPR_KEYS.has(key)) return { kind: "text", options: [], mono: true };
      return { kind: "text", options: [] };
    case "ZodNumber":
      return { kind: "number", options: [], ...numberBounds(core) };
    case "ZodBoolean":
      return { kind: "boolean", options: [] };
    case "ZodEnum":
      return { kind: "enum", options: core._def.values as string[] };
    case "ZodArray": {
      const el = peel(core._def.type as AnyZod).core;
      return el._def.typeName === "ZodString"
        ? { kind: "string-list", options: [] }
        : { kind: "json", options: [] };
    }
    case "ZodObject":
      return objectInfo(core);
    case "ZodRecord":
      return recordInfo(core);
    case "ZodUnion":
      return unionInfo(core);
    default:
      return { kind: "json", options: [] };
  }
}

function describeField(key: string, field: AnyZod): FieldSpec {
  const { core, optional, default: dflt } = peel(field);
  const info = kindOf(key, core);
  return { key, optional, default: dflt, ...info };
}

/** Describe a node configSchema as a flat list of editable fields. */
export function describeSchema(schema: z.ZodTypeAny): FieldSpec[] {
  const obj = unwrapEffects(schema as unknown as AnyZod);
  if (obj._def.typeName !== "ZodObject") return [];
  const shapeFn = obj._def.shape as () => Record<string, AnyZod>;
  const shape = shapeFn();
  return Object.entries(shape).map(([key, field]) => describeField(key, field));
}
