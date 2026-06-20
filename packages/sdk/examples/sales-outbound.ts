import { z } from "zod";
import { anthropic, defineFlow, defineTool } from "@construct/sdk";
import { isMain, printFlowReport } from "./_util.js";

/**
 * Outbound sales research agent — stress case:
 *   research agent (tool loop) → branch on data quality → human collect cycle
 *   → draft email → human approve/edit loop → send_email (dangerous)
 */
const ReadinessSchema = z.object({ ready: z.boolean() });
const DraftSchema = z.object({ subject: z.string(), body: z.string() });

const webSearch = defineTool({
  name: "web_search",
  description: "Search the public web for company signals.",
  tier: "read",
  input: z.object({ query: z.string() }),
  run: () => [{ title: "Acme raises Series B", url: "https://example.com" }],
});

const crmSearch = defineTool({
  name: "crm_search",
  description: "Search CRM for account and contact history.",
  tier: "read",
  input: z.object({ domain: z.string() }),
  run: () => ({ contacts: 3, lastTouch: "2025-11-01" }),
});

const sendEmail = defineTool({
  name: "send_email",
  description: "Send the approved outbound email.",
  tier: "dangerous",
  requiresApproval: true,
  input: z.object({ to: z.string(), subject: z.string(), body: z.string() }),
  run: () => ({ messageId: "msg_123" }),
});

export const salesOutbound = defineFlow("sales-outbound", "Outbound sales research agent", (f) => {
  const domain = f.text("domain");
  const contactEmail = f.text("contactEmail");
  const research = f.json("research");
  const readiness = f.json("readiness", ReadinessSchema);
  const missing = f.json("missing");
  const draft = f.json("draft", DraftSchema);
  const feedback = f.text("feedback");
  const sent = f.json("sent");

  const out = f.output(sent, { label: "Sent" });
  const mailbox = f.resource("mailbox", "email", { scope: "session" });

  const gather = f
    .input({ schema: { domain, contactEmail }, label: "Prospect" })
    .agent({
      label: "Account researcher",
      description: "Research the prospect via web and CRM lookups.",
      model: anthropic("claude-sonnet-4-6"),
      prompt: f.tpl`Research ${domain} for a personalized outbound pitch`,
      tools: [webSearch, crmSearch],
      maxSteps: 8,
      writeTo: research,
    })
    .agent({
      label: "Readiness check",
      description: "Decide whether there is enough to write the email.",
      model: anthropic("claude-haiku-4-5"),
      output: ReadinessSchema,
      prompt: f.tpl`Do we have enough to write email? ${research}`,
      writeTo: readiness,
    });

  const qualityGate = gather.branch({ condition: readiness.path("ready"), label: "Readiness gate" });
  qualityGate
    .on("false")
    .human({ mode: "collect", prompt: "What is missing?", writeTo: missing, label: "Gather missing info" })
    .to(gather);

  const compose = qualityGate
    .on("true")
    .agent({
      label: "Email writer",
      description: "Draft the outbound email from the research.",
      model: anthropic("claude-sonnet-4-6"),
      output: DraftSchema,
      prompt: f.tpl`Write outbound email using ${research} for ${contactEmail}`,
      writeTo: draft,
    });

  const review = compose.human({
    mode: "annotate",
    exits: ["approved", "edit", "reject"],
    writeTo: feedback,
    label: "Review draft",
  });

  review.on("edit").agent({
    label: "Apply edits",
    description: "Revise the draft to address reviewer feedback.",
    model: anthropic("claude-sonnet-4-6"),
    output: DraftSchema,
    prompt: f.tpl`Revise ${draft} per feedback ${feedback}`,
    writeTo: draft,
  }).to(review);

  review
    .on("approved")
    .tool(sendEmail, {
      args: { to: contactEmail, subject: draft.path("subject"), body: draft.path("body") },
      resource: mailbox,
      writeTo: sent,
      label: "Send email",
    })
    .to(out);

  review.on("reject").to(out);
});

if (isMain(import.meta.url)) printFlowReport(salesOutbound);
