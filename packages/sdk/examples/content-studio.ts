import { z } from "zod";
import { defineFlow, defineTool, gemini } from "@construct/sdk";
import { isMain, printFlowReport } from "./_util.js";

/**
 * Content studio — a production content-generation pipeline ported from a
 * Trigger.dev orchestrator. Demonstrates the shape of a real multi-step agentic
 * job in the visual DSL:
 *
 *   input(sources, product)
 *     → map(per source → extract-source subflow)  — ground uploads into a corpus
 *     → analysis (agent)                          — distil the shared brief
 *     → core (agent)                              — title / positioning
 *     → FAN-OUT (parallel, joined "all"):
 *          A. page-list (agent) → map(per page → page-content subflow)
 *          B. landing (agent)
 *          C. pricing (agent)
 *          D. cover image (generate_image tool)
 *     → join(all) → output(core, pages, landing, pricing, cover)
 *
 * Per-step model tuning mirrors the source pipeline: a cheap/fast model on the
 * mechanical steps, the strong model on the substance-carrying ones (landing +
 * per-page content), with thinking budget passed through `params`.
 *
 * Faithful to the original topology. Per-item partial failure is preserved with
 * `onError: "collect"` on both `map`s — like the original, a page (or source)
 * that fails does not abort the run; its failure is collected inline as
 * `{ error, index }` next to the successful items. The original grounded several
 * source types (PDF/DOCX via parsers, images, links) with provider fallback;
 * this port simplifies that to `extract_document` over the uploaded documents.
 * Two behaviors the original relied on are still NOT first-class in the engine:
 * per-node retry/backoff, and idempotent step caching for cheap re-runs. The
 * original also treated the cover image as non-fatal; here it sits under
 * `join("all")`, so a cover failure would fail the run — the engine has no
 * per-branch error isolation yet.
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

const SourceTextSchema = z.object({ text: z.string(), format: z.string() });

/** Pull the plain text out of one uploaded PDF/DOCX in the run's workspace. */
const extractDocument = defineTool({
  name: "extract_document",
  description: "Extract the plain text from a PDF or DOCX file in the run's workspace.",
  tier: "content",
  input: z.object({ path: z.string() }),
  run: () => ({ text: "", format: "pdf" }),
});

/** Generate the product cover image from a text prompt. */
const generateImage = defineTool({
  name: "generate_image",
  description: "Generate an image from a text prompt and save it into the run's workspace.",
  tier: "content",
  input: z.object({ prompt: z.string(), path: z.string().optional() }),
  run: () => ({ path: "cover.png" }),
});

/**
 * Per-source body run once per upload by the grounding `map`. `map` seeds each
 * source path as the `item` channel; the body extracts that one document into
 * text, and the map collects every result into the shared corpus.
 */
const extractSource = defineFlow("extract-source", "Extract one source document", (f) => {
  const item = f.text("item");
  const text = f.json("text", SourceTextSchema);

  f.input({ schema: { item } })
    .tool(extractDocument, { args: { path: item }, writeTo: text })
    .to(f.output(text));
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

  f.input({ schema: { item } })
    .agent({
      model: gemini("gemini-2.5-pro", { temperature: 0.65, params: { thinkingBudget: 24_576 } }),
      output: PageContentSchema,
      prompt: f.tpl`Write the full content for the chapter ${item} of the product ${core}.`,
      writeTo: page,
    })
    .to(f.output(page));
});

export const contentStudio = defineFlow("content-studio", "Content studio pipeline", (f) => {
  const sources = f.json("sources", z.array(z.string()), { reducer: "append" });
  const product = f.json("product");
  const corpus = f.json("corpus", { reducer: "append" });
  const analysis = f.json("analysis", AnalysisSchema);
  const core = f.json("core", CoreSchema);
  const pageList = f.json("pageList", PageListSchema);
  const pages = f.json("pages", { reducer: "append" });
  const landing = f.json("landing", LandingSchema);
  const pricing = f.json("pricing", PricingSchema);
  const cover = f.json("cover");

  // Ground the uploads, then build the shared brief and product core.
  const coreNode = f
    .input({ schema: { sources, product } })
    .map({
      over: sources,
      body: extractSource,
      concurrency: 4,
      aggregate: "collect",
      onError: "collect",
      writeTo: corpus,
    })
    .agent({
      model: gemini("gemini-2.5-flash", { temperature: 0.3, params: { thinkingBudget: 8_192 } }),
      output: AnalysisSchema,
      prompt: f.tpl`Analyse the source material and write a product brief: ${corpus}`,
      writeTo: analysis,
    })
    .agent({
      model: gemini("gemini-2.5-flash", { temperature: 0.6, params: { thinkingBudget: 2_048 } }),
      output: CoreSchema,
      prompt: f.tpl`Name and position the product from this brief: ${analysis}`,
      writeTo: core,
    });

  // Fan out from the core: chapters (+ per-page content), landing, pricing, cover.
  const perPage = coreNode
    .agent({
      model: gemini("gemini-2.5-flash", { temperature: 0.7, params: { thinkingBudget: 8_192 } }),
      output: PageListSchema,
      prompt: f.tpl`Outline the chapters for ${core} using ${corpus}.`,
      writeTo: pageList,
    })
    .map({
      over: pageList.path("pages"),
      body: pageContent,
      concurrency: 4,
      aggregate: "collect",
      onError: "collect",
      writeTo: pages,
    });

  const landingNode = coreNode.agent({
    model: gemini("gemini-2.5-pro", { temperature: 0.7, params: { thinkingBudget: 16_384 } }),
    output: LandingSchema,
    prompt: f.tpl`Write the landing page for ${core}.`,
    writeTo: landing,
  });

  const pricingNode = coreNode.agent({
    model: gemini("gemini-2.5-flash", { temperature: 0.5 }),
    output: PricingSchema,
    prompt: f.tpl`Propose pricing tiers for ${core}.`,
    writeTo: pricing,
  });

  const coverNode = coreNode.tool(generateImage, {
    args: { prompt: core.path("title") },
    writeTo: cover,
  });

  f.join([perPage, landingNode, pricingNode, coverNode], { mode: "all" }).to(
    f.output({
      core: core.$,
      pages: pages.$,
      landing: landing.$,
      pricing: pricing.$,
      cover: cover.$,
    }),
  );
});

if (isMain(import.meta.url)) printFlowReport(contentStudio);
