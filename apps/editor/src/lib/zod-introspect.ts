import type { z } from "zod";

export type FieldKind =
  | "text"
  | "textarea"
  | "number"
  | "boolean"
  | "enum"
  | "string-list"
  | "json";

export interface FieldSpec {
  key: string;
  kind: FieldKind;
  optional: boolean;
  default: unknown;
  options: readonly string[];
}

// zod v3 internals are untyped here; navigate via a loose alias.
type AnyDef = { typeName: string; [k: string]: unknown };
type AnyZod = { _def: AnyDef };

const TEXTAREA_KEYS = new Set([
  "system",
  "prompt",
  "inline",
  "expr",
  "query",
  "condition",
]);

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

/** Remove Optional/Default/Nullable layers, capturing a default if present. */
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

function kindOf(key: string, core: AnyZod): { kind: FieldKind; options: readonly string[] } {
  const tn = core._def.typeName;
  switch (tn) {
    case "ZodString":
      return { kind: TEXTAREA_KEYS.has(key) ? "textarea" : "text", options: [] };
    case "ZodNumber":
      return { kind: "number", options: [] };
    case "ZodBoolean":
      return { kind: "boolean", options: [] };
    case "ZodEnum":
      return { kind: "enum", options: core._def.values as string[] };
    case "ZodArray": {
      const el = core._def.type as AnyZod;
      return el._def.typeName === "ZodString"
        ? { kind: "string-list", options: [] }
        : { kind: "json", options: [] };
    }
    default:
      return { kind: "json", options: [] };
  }
}

/** Describe a node configSchema as a flat list of editable fields. */
export function describeSchema(schema: z.ZodTypeAny): FieldSpec[] {
  const obj = unwrapEffects(schema as unknown as AnyZod);
  if (obj._def.typeName !== "ZodObject") return [];
  const shapeFn = obj._def.shape as () => Record<string, AnyZod>;
  const shape = shapeFn();
  return Object.entries(shape).map(([key, field]) => {
    const { core, optional, default: dflt } = peel(field);
    const { kind, options } = kindOf(key, core);
    return { key, kind, optional, default: dflt, options };
  });
}
