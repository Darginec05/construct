import { z } from "zod";
import { anthropic, defineFlow } from "@construct/sdk";
import { isMain, printFlowReport } from "./_util.js";

/**
 * Document intake pipeline — stress case:
 *   map(files, concurrency 8) → compliance agent → branch
 *   → loop(fix subflow) cycle | human annotate → output
 */
const ComplianceSchema = z.object({ pass: z.boolean(), risks: z.array(z.string()) });
const FixSchema = z.object({ pass: z.boolean() });

const extractSection = defineFlow("extract_section", "Extract one document section", (f) => {
  const file = f.file("file");
  const section = f.json("section");
  f.input({ schema: { file }, label: "Document file" })
    .agent({
      label: "Section extractor",
      description: "Extract one document's title and text.",
      model: anthropic("claude-sonnet-4-6"),
      prompt: file,
      output: z.object({ title: z.string(), text: z.string() }),
      writeTo: section,
    })
    .to(f.output(section, { label: "Section" }));
});

const fixCompliance = defineFlow("fix_compliance", "Fix compliance issues", (f) => {
  const sections = f.json("sections", { reducer: "append" });
  const report = f.json("report", ComplianceSchema);
  const fixed = f.json("fixed", FixSchema);
  f.input({ schema: { sections, report }, label: "Sections + report" })
    .agent({
      label: "Compliance fixer",
      description: "Rewrite sections to resolve the flagged risks.",
      model: anthropic("claude-sonnet-4-6"),
      prompt: f.tpl`Fix ${sections} given issues ${report}`,
      output: FixSchema,
      writeTo: fixed,
    })
    .to(f.output(fixed, { label: "Fixed" }));
});

export const documentIntake = defineFlow("document-intake", "Document intake pipeline", (f) => {
  const files = f.file("files", { reducer: "append" });
  const sections = f.json("sections", { reducer: "append" });
  const report = f.json("report", ComplianceSchema);
  const feedback = f.text("feedback");
  const bundle = f.json("bundle");

  const extracted = f
    .input({ schema: { files }, label: "Uploaded files" })
    .map({
      label: "Per-file extract",
      over: files,
      body: extractSection,
      concurrency: 8,
      aggregate: "collect",
      writeTo: sections,
    });

  const compliance = extracted.agent({
    label: "Compliance review",
    description: "Flag compliance risks across the extracted sections.",
    model: anthropic("claude-sonnet-4-6"),
    output: ComplianceSchema,
    prompt: f.tpl`Review ${sections} for compliance risks`,
    writeTo: report,
  });

  const gate = compliance.branch({ condition: report.path("pass"), label: "Compliance gate" });

  gate
    .on("false")
    .loop({
      label: "Fix loop",
      body: fixCompliance,
      until: report.path("pass"),
      maxIterations: 5,
      writeTo: sections,
    })
    .to(compliance);

  gate
    .on("true")
    .human({ mode: "annotate", prompt: "Review extracted bundle", writeTo: feedback, label: "Review bundle" })
    .to(f.output({ sections: sections.$, report: report.$, feedback: feedback.$ }, { label: "Intake bundle" }));
});

if (isMain(import.meta.url)) printFlowReport(documentIntake);
