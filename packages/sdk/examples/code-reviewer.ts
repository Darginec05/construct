import { z } from "zod";
import { anthropic, defineFlow } from "@construct/sdk";
import { isMain, printFlowReport } from "./_util.js";

/**
 * Code reviewer — a lightweight test flow with structured agent output.
 *
 * Paste a snippet; one Haiku agent returns a scored review with typed findings.
 * Good for smoke-testing async runs, observe traces, and JSON output parsing.
 *
 *   input(code, language?)
 *     → review (agent, haiku)   — pass, score, findings[], fixedCode
 *     → output
 */

const FindingSchema = z.object({
  severity: z.enum(["critical", "major", "minor", "info"]),
  category: z.enum(["bug", "security", "performance", "style", "maintainability", "testing"]),
  title: z.string(),
  detail: z.string(),
  suggestion: z.string(),
});

const CodeReviewSchema = z.object({
  pass: z.boolean(),
  score: z.number().min(0).max(100),
  summary: z.string(),
  strengths: z.array(z.string()).max(3),
  findings: z.array(FindingSchema).max(8),
  /** Full snippet with suggested fixes applied; same language as the input. */
  fixedCode: z.string(),
});

export const codeReviewer = defineFlow("code-reviewer", "Code reviewer", (f) => {
  const code = f.text("code");
  const language = f.text("language");
  const reviewOutput = f.json("review-output", CodeReviewSchema);

  const result = f.output(
    {
      pass: reviewOutput.path("pass"),
      score: reviewOutput.path("score"),
      summary: reviewOutput.path("summary"),
      strengths: reviewOutput.path("strengths"),
      findings: reviewOutput.path("findings"),
      fixedCode: reviewOutput.path("fixedCode"),
    },
    { label: "Review" },
  );

  f.input({ schema: { code, language }, label: "Code snippet" })
    .agent({
      label: "Code reviewer",
      description: "Review the snippet and return structured findings.",
      model: anthropic("claude-haiku-4-5", { maxTokens: 8192 }),
      output: CodeReviewSchema,
      prompt: f.tpl`Review this code${language}. Focus on correctness, security, and clarity. Be concise.

Code:
${code}

Return:
- pass: true only if you would approve as-is (no critical/major issues)
- score: 0-100 overall quality
- summary: one paragraph verdict
- strengths: up to 3 things done well
- findings: concrete issues with severity, category, title, detail, and a fix suggestion
- fixedCode: the full rewritten snippet with your fixes applied (plain source only — no markdown fences); if pass is true, return the original with only minor polish`,
      writeTo: reviewOutput,
    })
    .to(result);
});

if (isMain(import.meta.url)) printFlowReport(codeReviewer);
