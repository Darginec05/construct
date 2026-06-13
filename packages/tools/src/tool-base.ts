import type { ToolTier } from "@construct/dsl";
import type { z } from "zod";
import { toJsonSchema } from "./schema.js";
import type { Tool } from "./index.js";

/**
 * Core tool authoring + registry, split out of the package barrel so the
 * built-in tools can author themselves without importing the barrel. Keeping
 * these here breaks the `index` ↔ `builtins` import cycle (a cycle that also
 * trips esbuild's `keepNames` helper under tsx). `Tool` is imported as a type
 * only, so this module has no runtime edge back to the barrel.
 */

/**
 * Author a tool from a Zod input schema. The schema is used both to derive the
 * advertised JSON Schema `parameters` and to parse/validate raw input before
 * `run`. Pass explicit `parameters` to override the derived schema (e.g. for a
 * shape the converter doesn't cover).
 */
export interface ToolDefinition<I> {
  name: string;
  description: string;
  input?: z.ZodType<I>;
  parameters?: Record<string, unknown>;
  tier?: ToolTier;
  requiresApproval?: boolean;
  run(input: I): unknown | Promise<unknown>;
}

export function defineTool<I = unknown>(spec: ToolDefinition<I>): Tool {
  const input = spec.input;
  const parameters =
    spec.parameters ??
    (input
      ? toJsonSchema(input as unknown as z.ZodTypeAny)
      : { type: "object", properties: {} });
  return {
    name: spec.name,
    description: spec.description,
    parameters,
    tier: spec.tier,
    requiresApproval: spec.requiresApproval,
    run: (raw: unknown) => spec.run(input ? input.parse(raw) : (raw as I)),
  };
}

const registry = new Map<string, Tool>();

export function registerTool(tool: Tool): void {
  registry.set(tool.name, tool);
}

export function getTool(name: string): Tool | undefined {
  return registry.get(name);
}

export function listTools(): Tool[] {
  return [...registry.values()];
}
