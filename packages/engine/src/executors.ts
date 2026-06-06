import type {
  ExecutorContext,
  ExecutorResult,
  NodeExecutor,
  RunFunction,
} from "./types.js";

/**
 * Leaf-node execution registry. Control-flow nodes (input, output, branch,
 * switch, join, loop, map, subflow, human) are intrinsic to the runner; every
 * other node type resolves an executor here. The engine ships pure built-ins
 * (`transform`, `code`); @construct/nodes registers the model/tool-backed ones.
 */

const executors = new Map<string, NodeExecutor>();
const functions = new Map<string, RunFunction>();

export function registerExecutor(type: string, executor: NodeExecutor): void {
  executors.set(type, executor);
}

export function getExecutor(type: string): NodeExecutor | undefined {
  return executors.get(type);
}

/** Register a named function backing `code` nodes (referenced by `ref`). */
export function registerFunction(name: string, fn: RunFunction): void {
  functions.set(name, fn);
}

export function getFunction(name: string): RunFunction | undefined {
  return functions.get(name);
}

function writePatch(
  writeTo: unknown,
  value: unknown,
): ExecutorResult {
  return typeof writeTo === "string" ? { patch: { [writeTo]: value } } : {};
}

registerExecutor("transform", (ctx: ExecutorContext) => {
  const value = ctx.evaluate(ctx.config.expr);
  return writePatch(ctx.config.writeTo, value);
});

registerExecutor("code", async (ctx: ExecutorContext) => {
  const ref = ctx.config.ref;
  if (typeof ref !== "string") {
    throw new Error("code node: inline source is not supported in v1; use `ref`");
  }
  const fn = getFunction(ref);
  if (!fn) {
    throw new Error(`code node: no function registered for ref "${ref}"`);
  }
  const value = await fn(ctx);
  return writePatch(ctx.config.writeTo, value);
});
