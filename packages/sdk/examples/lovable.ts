import { z } from "zod";
import { anthropic, defineFlow, defineTool } from "@construct/sdk";

/**
 * The Lovable-like code agent, authored with the fluent SDK:
 *   plan -> parallel workers (map) -> build -> reflect loop -> approval.
 * `map` fans the plan's tasks across a `worker_subflow`; `loop` re-runs a
 * `fix_subflow` until the build passes. Both bodies are bundled by reference.
 */

const PlanSchema = z.object({ tasks: z.array(z.string()) });
const BuildSchema = z.object({ ok: z.boolean() });

/** Build one file from a single planned task. Used as the `map` body. */
const worker = defineFlow("worker_subflow", "Build one file", (flow) => {
  const task = flow.json("task");
  const file = flow.file("file");
  flow.input({ channel: task })
    .agent({ model: anthropic("claude-sonnet-4-6"), prompt: task, writeTo: file })
    .to(flow.output(file));
});

/** Repair the workspace after a failed build. Used as the `loop` body. */
const fix = defineFlow("fix_subflow", "Fix build errors", (flow) => {
  const files = flow.file("files", { reducer: "merge" });
  flow.input({ channel: files })
    .agent({ model: anthropic("claude-sonnet-4-6"), prompt: files, writeTo: files })
    .to(flow.output(files));
});

const codeExec = defineTool({
  name: "code_exec",
  description: "Run a build command in the sandbox.",
  tier: "write",
  input: z.object({ cmd: z.string() }),
  run: () => ({ ok: true }),
});

export const lovable = defineFlow("lovable", "Lovable-like code agent", (flow) => {
  const prompt = flow.text("prompt");
  const plan = flow.json("plan", PlanSchema);
  const files = flow.file("files", { reducer: "merge" });
  const build = flow.json("build", BuildSchema);

  const sandbox = flow.resource("sandbox", "sandbox", { scope: "run" });

  flow.input({ channel: prompt })
    .agent({ model: anthropic("claude-sonnet-4-6"), output: PlanSchema, writeTo: plan })
    .map({
      over: plan.path("tasks"),
      body: worker,
      concurrency: 4,
      aggregate: "merge",
      writeTo: files,
    })
    .tool(codeExec, { args: { cmd: "build" }, resource: sandbox, writeTo: build })
    .loop({ body: fix, until: build.path("ok"), maxIterations: 5, writeTo: files })
    .human({ mode: "approve" })
    .on("approved")
    .to(flow.output(files));
});

console.log(JSON.stringify(lovable.toJSON(), null, 2));
