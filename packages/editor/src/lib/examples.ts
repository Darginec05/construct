import { anthropic, defineFlow, defineTool, type FlowDefinition } from "@construct/sdk";
import { z } from "zod";
import type { FlowDoc } from "../flow/types.ts";
import { fromDslFlow } from "../flow/serialize.ts";

export interface ExampleDef {
  id: string;
  name: string;
  description: string;
  flows: FlowDoc[];
}

/** Convert an SDK flow (+ its subflow bodies) into an editor workspace. */
function workspace(main: FlowDefinition, subs: FlowDefinition[] = []): FlowDoc[] {
  return [
    fromDslFlow(main.toJSON(), { kind: "main" }),
    ...subs.map((s) => fromDslFlow(s.toJSON(), { kind: "sub", parent: main.id })),
  ];
}

// --- 1. Assistant: the minimal single-agent flow ---------------------------

const assistant = defineFlow("assistant", "Assistant", (f) => {
  const message = f.text("message");
  const reply = f.text("reply");
  f.input({ channel: message })
    .agent({ model: anthropic("claude-sonnet-4-6"), prompt: message, writeTo: reply })
    .to(f.output(reply));
});

// --- 2. Support router: router fork with a gated write arm -----------------

const crmUpdate = defineTool({
  name: "crm_update",
  description: "Update a customer record in the CRM.",
  tier: "write",
  run: () => null,
});

const supportRouter = defineFlow("support-router", "Support router", (f) => {
  const message = f.text("message");
  const intent = f.json("intent");
  const result = f.json("result");
  f.resource("crmdb", "db", { scope: "session" });

  const router = f
    .input({ channel: message })
    .router({
      model: anthropic("claude-haiku-4-5"),
      prompt: message,
      classes: [
        { name: "read", description: "Look up or read an existing customer record." },
        { name: "write", description: "Create or update a customer record." },
      ],
      writeTo: intent,
    });

  const out = f.output(result);
  router.on("read").agent({ model: anthropic("claude-sonnet-4-6"), prompt: message, writeTo: result }).to(out);
  router
    .on("write")
    .tool(crmUpdate, { writeTo: result })
    .human({ mode: "approve", ttl: 3600 })
    .on("approved")
    .to(out);
});

// --- 3. Website builder: fan-out, AND-join, validation loop, human review --

const TasksSchema = z.object({ tasks: z.array(z.string()) });
const IssuesSchema = z.object({ pass: z.boolean(), issues: z.array(z.string()) });

const subAgent = (id: string, name: string) =>
  defineFlow(id, name, (flow) => {
    const input = flow.json("input");
    const output = flow.json("output");
    flow
      .input({ channel: input })
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

const websiteBuilder = defineFlow("website-builder", "Website builder", (flow) => {
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

  gate.on("false").to(orchestrator);

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

export const EXAMPLES: ExampleDef[] = [
  {
    id: "assistant",
    name: "Assistant",
    description: "A single agent that answers a message.",
    flows: workspace(assistant),
  },
  {
    id: "support-router",
    name: "Support router",
    description: "Classify intent, then read directly or take a gated write action.",
    flows: workspace(supportRouter),
  },
  {
    id: "website-builder",
    name: "Website builder",
    description: "Fan out to four subagents, join, build, validate in a loop, then deploy on human approval.",
    flows: workspace(websiteBuilder, [researchAgent, designAgent, contentAgent, assetAgent, buildAgent]),
  },
];
