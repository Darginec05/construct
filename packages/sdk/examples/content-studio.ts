import { z } from "zod";
import { defineFlow, defineTool, gemini } from "@construct/sdk";
import { isMain, printFlowReport } from "./_util.js";

/**
 * Content studio — a production content-generation pipeline ported from a
 * Trigger.dev orchestrator. Demonstrates the shape of a real multi-step agentic
 * job in the visual DSL:
 *
 *   input(sources, product)
 *     → resolve_sources (grounding tool)        — extract uploads into a corpus
 *     → analysis (agent)                         — distil the shared brief
 *     → core (agent)                             — title / positioning
 *     → FAN-OUT (parallel, joined "all"):
 *          A. page-list (agent) → map(per page → page-content subflow)
 *          B. landing (agent)
 *          C. pricing (agent)
 *          D. cover image (tool)
 *     → join(all) → output(core, pages, landing, pricing, cover)
 *
 * Per-step model tuning mirrors the source pipeline: a cheap/fast model on the
 * mechanical steps, the strong model on the substance-carrying ones (landing +
 * per-page content), with thinking budget passed through `params`.
 *
 * Faithful to the original topology. Three behaviors the original relied on are
 * NOT yet first-class in the engine and are simplified here: per-item partial
 * failure in `map` (the original collects failed pages and continues), per-node
 * retry/backoff, and idempotent step caching for cheap re-runs.
 */

const AnalysisSchema = z.object({
  language: z.string(),
  summary: z.string(),
});

const CoreSchema = z.object({
  title: z.string(),
  short_description: z.string(),
});

const PageSpecSchema = z.object({
  title: z.string(),
  description: z.string(),
});

const PageListSchema = z.object({
  pages: z.array(PageSpecSchema).min(1).max(50),
});

const PageContentSchema = z.object({
  title: z.string(),
  blocks: z.array(z.string()),
});

const LandingSchema = z.object({
  blocks: z.array(z.string()),
});

const PricingSchema = z.object({
  tiers: z.array(z.object({ name: z.string(), price: z.string() })),
});

/** Resolve uploaded sources (files/links) into a single grounded text corpus. */
const resolveSources = defineTool({
  name: "resolve_sources",
  description: "Extract uploaded files and links into a grounded text corpus.",
  tier: "read",
  input: z.object({ sources: z.array(z.unknown()) }),
  run: () => ({ corpus: "" }),
});

/** Generate the product cover image from its title. */
const generateCover = defineTool({
  name: "generate_cover",
  description: "Generate a cover image for the product.",
  tier: "content",
  input: z.object({ title: z.string() }),
  run: () => ({ url: "https://example.com/cover.png" }),
});

/**
 * Per-page body run once per chapter by the `map` node. `map` seeds each element
 * of the page list as the `item` channel; the parent `core` channel is visible
 * too, so a page is written with the product context in hand.
 */
const pageContent = defineFlow("page-content", "Write one page", (f) => {
  const item = f.json("item", PageSpecSchema);
  const core = f.json("core", CoreSchema);
  const page = f.json("page", PageContentSchema);

  f.input({ schema: { item }, label: "Chapter spec" })
    .agent({
      label: "Page writer",
      description: "Write the full content for one chapter.",
      model: gemini("gemini-2.5-pro", { temperature: 0.65, params: { thinkingBudget: 24_576 } }),
      output: PageContentSchema,
      prompt: f.tpl`Write the full content for the chapter ${item} of the product ${core}.`,
      writeTo: page,
    })
    .to(f.output(page, { label: "Page" }));
});

export const contentStudio = defineFlow("content-studio", "Content studio pipeline", (f) => {
  const sources = f.file("sources", { reducer: "append" });
  const product = f.json("product");
  const corpus = f.json("corpus");
  const analysis = f.json("analysis", AnalysisSchema);
  const core = f.json("core", CoreSchema);
  const pageList = f.json("pageList", PageListSchema);
  const pages = f.json("pages", { reducer: "append" });
  const landing = f.json("landing", LandingSchema);
  const pricing = f.json("pricing", PricingSchema);
  const cover = f.json("cover");

  // Ground the uploads, then build the shared brief and product core.
  const coreNode = f
    .input({ schema: { sources, product }, label: "Sources + product" })
    .tool(resolveSources, { args: { sources }, writeTo: corpus, label: "Ground sources" })
    .agent({
      label: "Brief writer",
      description: "Distil the sources into a product brief.",
      model: gemini("gemini-2.5-flash", { temperature: 0.3, params: { thinkingBudget: 8_192 } }),
      output: AnalysisSchema,
      prompt: f.tpl`Analyse the source material and write a product brief: ${corpus}`,
      writeTo: analysis,
    })
    .agent({
      label: "Product core",
      description: "Name and position the product from the brief.",
      model: gemini("gemini-2.5-flash", { temperature: 0.6, params: { thinkingBudget: 2_048 } }),
      output: CoreSchema,
      prompt: f.tpl`Name and position the product from this brief: ${analysis}`,
      writeTo: core,
    });

  // Fan out from the core: chapters (+ per-page content), landing, pricing, cover.
  const perPage = coreNode
    .agent({
      label: "Chapter outliner",
      description: "Outline the product's chapters.",
      model: gemini("gemini-2.5-flash", { temperature: 0.7, params: { thinkingBudget: 8_192 } }),
      output: PageListSchema,
      prompt: f.tpl`Outline the chapters for ${core} using ${corpus}.`,
      writeTo: pageList,
    })
    .map({
      label: "Per-page content",
      over: pageList.path("pages"),
      body: pageContent,
      concurrency: 4,
      aggregate: "collect",
      writeTo: pages,
    });

  const landingNode = coreNode.agent({
    label: "Landing page",
    description: "Write the product landing page.",
    model: gemini("gemini-2.5-pro", { temperature: 0.7, params: { thinkingBudget: 16_384 } }),
    output: LandingSchema,
    prompt: f.tpl`Write the landing page for ${core}.`,
    writeTo: landing,
  });

  const pricingNode = coreNode.agent({
    label: "Pricing tiers",
    description: "Propose pricing tiers for the product.",
    model: gemini("gemini-2.5-flash", { temperature: 0.5 }),
    output: PricingSchema,
    prompt: f.tpl`Propose pricing tiers for ${core}.`,
    writeTo: pricing,
  });

  const coverNode = coreNode.tool(generateCover, {
    args: { title: core.path("title") },
    writeTo: cover,
    label: "Cover image",
  });

  f.join([perPage, landingNode, pricingNode, coverNode], { mode: "all", label: "Assemble result" }).to(
    f.output(
      {
        core: core.$,
        pages: pages.$,
        landing: landing.$,
        pricing: pricing.$,
        cover: cover.$,
      },
      { label: "Published content" },
    ),
  );
});

if (isMain(import.meta.url)) printFlowReport(contentStudio);
