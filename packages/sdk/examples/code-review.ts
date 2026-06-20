import { z } from "zod";
import { anthropic, defineFlow, defineTool } from "@construct/sdk";
import { isMain, printFlowReport } from "./_util.js";

/**
 * Multi-agent code review — stress case:
 *   plan diff → map(file reviewers, concurrency 6, merge) → synthesize findings
 *   → branch → loop(fix) cycle back → output
 */
const PlanSchema = z.object({
  files: z.array(z.string()),
  risk: z.enum(["low", "medium", "high"]),
});

const FindingsSchema = z.object({
  pass: z.boolean(),
  blockers: z.array(z.string()),
  suggestions: z.array(z.string()),
});

const fileReviewer = defineFlow("file_reviewer", "Review one file", (f) => {
  const file = f.text("file");
  const diff = f.text("diff");
  const review = f.json("review");
  f.input({ schema: { file, diff }, label: "File + diff" })
    .agent({
      label: "File reviewer",
      description: "Review the changes in one file.",
      model: anthropic("claude-sonnet-4-6"),
      prompt: f.tpl`Review changes in ${file}:\n${diff}`,
      output: z.object({ issues: z.array(z.string()), severity: z.string() }),
      writeTo: review,
    })
    .to(f.output(review, { label: "File review" }));
});

const fixSuggestions = defineFlow("fix_suggestions", "Apply review fixes", (f) => {
  const findings = f.json("findings", FindingsSchema);
  const workspace = f.file("workspace", { reducer: "merge" });
  const patched = f.json("patched", FindingsSchema);
  f.input({ schema: { findings, workspace }, label: "Findings + workspace" })
    .agent({
      label: "Fix applier",
      description: "Apply the review findings to the workspace.",
      model: anthropic("claude-sonnet-4-6"),
      output: FindingsSchema,
      prompt: f.tpl`Fix ${workspace} addressing ${findings}`,
      writeTo: patched,
    })
    .to(f.output(patched, { label: "Patched" }));
});

const runTests = defineTool({
  name: "run_tests",
  description: "Run the project test suite in CI.",
  tier: "read",
  input: z.object({ suite: z.string() }),
  run: () => ({ ok: true, failed: 0 }),
});

export const codeReview = defineFlow("code-review", "Multi-agent code review", (f) => {
  const diff = f.text("diff");
  const plan = f.json("plan", PlanSchema);
  const reviews = f.json("reviews", { reducer: "merge" });
  const findings = f.json("findings", FindingsSchema);
  const workspace = f.file("workspace", { reducer: "merge" });

  const ci = f.resource("ci", "sandbox", { scope: "run" });
  const out = f.output(findings, { label: "Final review" });

  const planned = f
    .input({ schema: { diff }, label: "Pull request diff" })
    .agent({
      label: "Review planner",
      description: "Plan which files to review and estimate the risk.",
      model: anthropic("claude-haiku-4-5"),
      output: PlanSchema,
      prompt: f.tpl`Plan a review for this diff:\n${diff}`,
      writeTo: plan,
    })
    .map({
      label: "Per-file review",
      over: plan.path("files"),
      body: fileReviewer,
      concurrency: 6,
      aggregate: "merge",
      writeTo: reviews,
    })
    .tool(runTests, { args: { suite: "unit" }, resource: ci, writeTo: workspace, label: "Run tests" });

  const synthesize = planned.agent({
    label: "Findings synthesizer",
    description: "Merge the per-file reviews into one final verdict.",
    model: anthropic("claude-sonnet-4-6"),
    output: FindingsSchema,
    prompt: f.tpl`Synthesize ${reviews} into final review for ${diff}`,
    writeTo: findings,
  });

  const passGate = synthesize.branch({ condition: findings.path("pass"), label: "Pass gate" });

  passGate
    .on("false")
    .loop({
      label: "Fix loop",
      body: fixSuggestions,
      until: findings.path("pass"),
      maxIterations: 3,
      writeTo: findings,
    })
    .to(synthesize);

  passGate.on("true").to(out);
});

if (isMain(import.meta.url)) printFlowReport(codeReview);
