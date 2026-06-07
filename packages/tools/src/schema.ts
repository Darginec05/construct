import type { z } from "zod";

/**
 * A deliberately small Zod → JSON Schema converter. It covers the shapes a tool
 * input realistically uses (objects of strings / numbers / booleans / enums /
 * arrays, optional + default, literals, descriptions) and nothing more — the
 * goal is to advertise a tool's parameters to the model, not to be a complete
 * JSON Schema emitter. Anything outside this subset should pass raw
 * `parameters` to {@link defineTool} instead.
 *
 * Kept in-package so `@construct/tools` depends only on `dsl` + `zod`.
 */

type Json = Record<string, unknown>;

// zod 3 tags every schema with a stable `_def.typeName`; we read it structurally.
function def(schema: z.ZodTypeAny): { typeName: string; [k: string]: unknown } {
  return (schema as unknown as { _def: { typeName: string } })._def;
}

function describe(schema: z.ZodTypeAny, out: Json): Json {
  const d = (schema as { description?: string }).description;
  if (d) out.description = d;
  return out;
}

/** Optional or defaulted fields are not required in the parent object. */
function isOptional(schema: z.ZodTypeAny): boolean {
  const t = def(schema).typeName;
  return t === "ZodOptional" || t === "ZodDefault";
}

export function toJsonSchema(schema: z.ZodTypeAny): Json {
  const d = def(schema);
  switch (d.typeName) {
    case "ZodString":
      return describe(schema, { type: "string" });
    case "ZodNumber":
      return describe(schema, { type: "number" });
    case "ZodBoolean":
      return describe(schema, { type: "boolean" });
    case "ZodLiteral":
      return describe(schema, { const: d.value });
    case "ZodEnum":
      return describe(schema, { type: "string", enum: [...(d.values as string[])] });
    case "ZodArray":
      return describe(schema, {
        type: "array",
        items: toJsonSchema(d.type as z.ZodTypeAny),
      });
    case "ZodObject": {
      const rawShape = d.shape as (() => Record<string, z.ZodTypeAny>) | Record<string, z.ZodTypeAny>;
      const shape = typeof rawShape === "function" ? rawShape() : rawShape;
      const properties: Json = {};
      const required: string[] = [];
      for (const [key, child] of Object.entries(shape)) {
        properties[key] = toJsonSchema(child);
        if (!isOptional(child)) required.push(key);
      }
      const out: Json = { type: "object", properties };
      if (required.length > 0) out.required = required;
      return describe(schema, out);
    }
    // Unwrap wrappers, preserving a description set on the wrapper itself.
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault": {
      const inner = (d.innerType ?? d.type) as z.ZodTypeAny;
      return describe(schema, toJsonSchema(inner));
    }
    default:
      // Unknown shape: advertise an open value rather than guessing wrong.
      return describe(schema, {});
  }
}
