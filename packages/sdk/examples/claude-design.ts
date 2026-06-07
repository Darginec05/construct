import { z } from "zod";
import { anthropic, defineFlow, defineTool } from "construct";
import { genComponent } from "./gen-component.flow.js";

/**
 * The Claude Design agent, authored with the fluent SDK:
 *   ground -> plan -> variant fan-out -> render -> critique -> (loop | pick).
 * `f.tpl` interpolates channel handles into the critic prompt; `gate.on("false")`
 * forms the back-edge that re-enters the fan-out until the critic passes.
 */

const TokensSchema = z.object({ tokens: z.array(z.string()) });
const PlanSchema = z.object({ components: z.array(z.string()) });
const CandidateSchema = z.object({ id: z.string(), code: z.string() });
const CritiqueSchema = z.object({ pass: z.boolean(), issues: z.array(z.string()) });

export const figmaRender = defineTool({
  name: "figma_render",
  description: "Render candidate nodes to a screenshot.",
  tier: "content",
  input: z.object({ nodes: z.unknown() }),
  run: () => ({ url: "https://example.com/shot.png" }),
});

export const claudeDesign = defineFlow("claude-design", "Claude Design agent", (f) => {
  const brief = f.text("brief");
  const refs = f.image("refs", { reducer: "append" });
  const tokens = f.json("tokens", TokensSchema);
  const plan = f.json("plan", PlanSchema);
  const candidates = f.json("candidates", CandidateSchema, { reducer: "append" });
  const screenshot = f.image("screenshot");
  const critique = f.json("critique", CritiqueSchema);

  const figma = f.resource("figma", "figma", { scope: "session" });

  const start = f.input({ schema: { brief, refs } });

  const variants = start
    .retrieve({ store: "design-system", query: brief, topK: 8, writeTo: tokens })
    .agent({ model: anthropic("claude-sonnet-4-6"), output: PlanSchema, writeTo: plan })
    .map({
      over: plan.path("components"),
      body: genComponent,
      aggregate: "collect",
      writeTo: candidates,
    });

  const gate = variants
    .tool(figmaRender, { args: { nodes: candidates }, resource: figma, writeTo: screenshot })
    .agent({
      model: anthropic("claude-sonnet-4-6"),
      prompt: f.tpl`Critique ${screenshot} against ${tokens}`,
      output: CritiqueSchema,
      writeTo: critique,
    })
    .branch({ condition: critique.path("pass") });

  gate.on("false").to(variants);
  gate.on("true").human({ mode: "select" }).on("next").to(f.output(candidates));
});

console.log(JSON.stringify(claudeDesign.toJSON(), null, 2));
