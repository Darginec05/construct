/**
 * @construct/engine — the stateful-graph runtime that executes a @construct/dsl
 * Flow: channels + reducers, expression evaluation, branching, OR-join / join
 * barriers, bounded loops, fan-out map, sub-flows, and durable human pauses.
 *
 * Control-flow nodes are intrinsic to the runner. Leaf nodes resolve through
 * the executor registry; the engine ships `transform` and `code`, while
 * @construct/nodes registers the model/tool-backed executors.
 */
export * from "./types.js";
export { runFlow } from "./run.js";
export {
  registerExecutor,
  getExecutor,
  registerFunction,
  getFunction,
} from "./executors.js";
export { evaluate, getByPath, truthy } from "./expr.js";
export { initState, applyPatch, channelMap } from "./channels.js";
