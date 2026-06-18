import { z } from "zod";
import { anthropic, defineFlow, defineTool } from "@construct/sdk";
import { isMain, printFlowReport } from "./_util.js";

/**
 * Enterprise support hub — stress case:
 *   router (4 classes + fallback) → parallel KB + sentiment (join all) on billing
 *   → specialist agents → quality branch → human approve → send_reply
 *   fallback → human collect → cycle back to router
 */
const QualitySchema = z.object({ ok: z.boolean() });

const refundLookup = defineTool({
  name: "refund_lookup",
  description: "Look up refund eligibility for a charge.",
  tier: "read",
  input: z.object({ chargeId: z.string() }),
  run: () => ({ eligible: true }),
});

const runDiagnostic = defineTool({
  name: "run_diagnostic",
  description: "Run a read-only integration diagnostic.",
  tier: "read",
  input: z.object({ service: z.string() }),
  run: () => ({ status: "ok" }),
});

const sendReply = defineTool({
  name: "send_reply",
  description: "Send the approved reply to the customer.",
  tier: "write",
  requiresApproval: true,
  input: z.object({ body: z.string(), ticketId: z.string() }),
  run: () => ({ sent: true }),
});

export const supportHub = defineFlow("support-hub", "Enterprise support hub", (f) => {
  const q = f.text("q");
  const ticketId = f.text("ticketId");
  const intent = f.json("intent");
  const kbHint = f.json("kb_hint");
  const sentiment = f.json("sentiment");
  const draft = f.text("draft");
  const quality = f.json("quality", QualitySchema);
  const clarified = f.json("clarified");
  const outbound = f.json("outbound");

  const mailbox = f.resource("mailbox", "email", { scope: "session" });
  const out = f.output(outbound);

  const route = f
    .input({ schema: { q, ticketId } })
    .router({
      model: anthropic("claude-haiku-4-5"),
      prompt: q,
      classes: [
        { name: "billing", description: "Invoices, charges, refunds, payment failures." },
        { name: "technical", description: "Outages, bugs, API errors, integrations." },
        { name: "sales", description: "Pricing, upgrades, demos, procurement." },
        { name: "abuse", description: "Spam, fraud, ToS violations." },
      ],
      fallback: true,
      writeTo: intent,
    });

  const enrich = f.join(
    [
      route.on("billing").retrieve({ store: "kb", query: q, topK: 3, writeTo: kbHint }),
      route.on("billing").agent({
        model: anthropic("claude-haiku-4-5"),
        output: z.object({ label: z.string() }),
        prompt: f.tpl`Classify sentiment: ${q}`,
        writeTo: sentiment,
      }),
    ],
    { mode: "all" },
  );

  const billingCheck = enrich
    .agent({
      model: anthropic("claude-sonnet-4-6"),
      prompt: f.tpl`Use ${kbHint} and ${sentiment} to answer: ${q}`,
      tools: [refundLookup],
      maxSteps: 6,
      writeTo: draft,
    })
    .agent({
      model: anthropic("claude-haiku-4-5"),
      output: QualitySchema,
      prompt: f.tpl`Is this answer complete? ${draft}`,
      writeTo: quality,
    });

  const billingGate = billingCheck.branch({ condition: quality.path("ok") });
  billingGate.on("false").to(route);

  billingGate
    .on("true")
    .human({ mode: "approve", prompt: "Send this reply?" })
    .on("approved")
    .tool(sendReply, { args: { body: draft, ticketId }, resource: mailbox, writeTo: outbound })
    .to(out);

  route
    .on("technical")
    .retrieve({ store: "kb", query: q, topK: 5, writeTo: kbHint })
    .agent({
      model: anthropic("claude-sonnet-4-6"),
      prompt: f.tpl`Support answer using ${kbHint}: ${q}`,
      tools: [runDiagnostic],
      maxSteps: 6,
      writeTo: draft,
    })
    .human({ mode: "approve" })
    .on("approved")
    .tool(sendReply, { args: { body: draft, ticketId }, resource: mailbox, writeTo: outbound })
    .to(out);

  route
    .on("sales")
    .agent({ model: anthropic("claude-sonnet-4-6"), prompt: q, writeTo: draft })
    .human({ mode: "approve" })
    .on("approved")
    .tool(sendReply, { args: { body: draft, ticketId }, resource: mailbox, writeTo: outbound })
    .to(out);

  route
    .on("abuse")
    .agent({
      model: anthropic("claude-haiku-4-5"),
      prompt: f.tpl`Triage abuse report: ${q}`,
      writeTo: draft,
    })
    .human({ mode: "approve", exits: ["approved", "escalate"] })
    .on("approved")
    .tool(sendReply, { args: { body: draft, ticketId }, resource: mailbox, writeTo: outbound })
    .to(out);

  route.on("fallback").human({ mode: "collect", prompt: "Need more detail", writeTo: clarified }).to(route);
});

if (isMain(import.meta.url)) printFlowReport(supportHub);
