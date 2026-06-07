import { z } from "zod";
import { anthropic, defineFlow, defineTool } from "@construct/sdk";

/**
 * The website-builder agent — the most demanding reference flow, authored with
 * the fluent SDK:
 *   intake -> route -> orchestrate -> 4-way fan-out -> AND-join -> build ->
 *   render -> validate -> (loop back | 3-way human review) -> deploy.
 *
 * It exercises a conversational `human` intake (mode "collect"), heterogeneous
 * parallel subagents gathered by an explicit `join` barrier (mode "all"), and a
 * human review with custom exits ("approved"/"changes"/"rejected"). Originally
 * authored as a deliberate stress case for the contract; the catalog has since
 * grown to cover all of it, so it now validates cleanly — the run below prints
 * any remaining gaps as a regression check.
 */

const TasksSchema = z.object({ tasks: z.array(z.string()) });
const IssuesSchema = z.object({ pass: z.boolean(), issues: z.array(z.string()) });

/** A trivial subagent body: take a dispatch, run a model, emit a result. */
const subAgent = (id: string, name: string) =>
  defineFlow(id, name, (flow) => {
    const input = flow.json("input");
    const output = flow.json("output");
    flow.input({ channel: input })
      .agent({ model: anthropic("claude-sonnet-4-6"), prompt: input, writeTo: output })
      .to(flow.output(output));
  });

const researchAgent = subAgent("research_agent", "Research agent");
const designAgent = subAgent("design_agent", "Design agent");
const contentAgent = subAgent("content_agent", "Content agent");
const assetAgent = subAgent("asset_agent", "Asset agent");
const buildAgent = subAgent("build_agent", "Build agent");

const assembleRender = defineTool({
  name: "assemble_render",
  description: "Assemble the generated files and render a preview.",
  tier: "write",
  input: z.object({ files: z.unknown() }),
  run: () => "preview://site",
});

const deploySite = defineTool({
  name: "deploy_site",
  description: "Deploy the site to hosting — irreversible, so it is gated.",
  tier: "dangerous",
  requiresApproval: true,
  input: z.object({ files: z.unknown() }),
  run: () => "https://example.com",
});

export const websiteBuilder = defineFlow("website-builder", "Website builder agent", (flow) => {
  const brief = flow.text("brief");
  const assets = flow.file("assets", { reducer: "append" });
  const spec = flow.json("spec");
  const routing = flow.json("routing");
  const research = flow.json("research");
  const tokens = flow.json("tokens");
  const content = flow.json("content");
  const media = flow.file("media", { reducer: "append" });
  const files = flow.file("files", { reducer: "merge" });
  const preview = flow.text("preview");
  const issues = flow.json("issues", IssuesSchema);
  const feedback = flow.text("feedback");
  const deployUrl = flow.text("deployUrl");

  const sandbox = flow.resource("sandbox", "sandbox", { scope: "run" });
  const hosting = flow.resource("hosting", "deploy", { scope: "session" });

  const orchestrator = flow
    .input({ schema: { brief, assets } })
    .human({ mode: "collect", prompt: "Clarify the brief", writeTo: spec })
    .transform({ expr: `computeRouting(${spec.$})`, writeTo: routing })
    .agent({ model: anthropic("claude-sonnet-4-6"), output: TasksSchema, writeTo: routing });

  // Fan out to four independent subagents, then gather them at an AND barrier.
  const barrier = flow.join(
    [
      orchestrator.subflow(researchAgent, { writeTo: research }),
      orchestrator.subflow(designAgent, { writeTo: tokens }),
      orchestrator.subflow(contentAgent, { writeTo: content }),
      orchestrator.subflow(assetAgent, { writeTo: media }),
    ],
    { mode: "all" },
  );

  const out = flow.output(deployUrl);

  const gate = barrier
    .subflow(buildAgent, { writeTo: files })
    .tool(assembleRender, { args: { files }, resource: sandbox, writeTo: preview })
    .agent({
      model: anthropic("claude-sonnet-4-6"),
      prompt: flow.tpl`Check ${preview} against ${spec}`,
      output: IssuesSchema,
      writeTo: issues,
    })
    .branch({ condition: issues.path("pass") });

  // Failed validation loops back to re-orchestrate.
  gate.on("false").to(orchestrator);

  // 3-way human review carrying free-text feedback.
  const review = gate.on("true").human({
    mode: "approve",
    exits: ["approved", "changes", "rejected"],
    writeTo: feedback,
  });

  review
    .on("approved")
    .tool(deploySite, { args: { files }, resource: hosting, writeTo: deployUrl })
    .to(out);
  review.on("changes").to(orchestrator);
  review.on("rejected").to(out);
});

console.log(JSON.stringify(websiteBuilder.toJSON(), null, 2));

const errors = websiteBuilder.validate().filter((i) => i.level === "error");
if (errors.length) {
  console.error(`\n${errors.length} validation gap(s) the catalog flags:`);
  for (const e of errors) console.error(`  - [${e.nodeId ?? e.edgeId ?? "?"}] ${e.message}`);
}
