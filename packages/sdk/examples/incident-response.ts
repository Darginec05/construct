import { z } from "zod";
import { anthropic, defineFlow, defineNode, defineTool, type NodeHandle } from "@construct/sdk";
import { isMain, printFlowReport } from "./_util.js";

/**
 * Incident response runbook — stress case:
 *   code severity score → switch(P0/P1) → parallel runbook subflows (join quorum 3/4)
 *   → synthesize postmortem → human approve → page_oncall (dangerous)
 */
const SeveritySchema = z.object({ label: z.string() });
const PostmortemSchema = z.object({ summary: z.string(), actions: z.array(z.string()) });

const severityScore = defineNode({
  id: "severityScore",
  run: (state: Record<string, unknown>) => {
    const alert = state.alert as Record<string, unknown> | undefined;
    const score = typeof alert?.score === "number" ? alert.score : 0;
    const label = score >= 9 ? "P0" : score >= 5 ? "P1" : "standard";
    return { label };
  },
});

const stubRunbook = (id: string, name: string) =>
  defineFlow(id, name, (f) => {
    const alert = f.json("alert");
    const notes = f.text("notes");
    f.input({ schema: { alert } })
      .agent({
        model: anthropic("claude-haiku-4-5"),
        prompt: f.tpl`${name} for ${alert}`,
        writeTo: notes,
      })
      .to(f.output(notes));
  });

const timelineRunbook = stubRunbook("timeline_runbook", "Timeline runbook");
const blastRunbook = stubRunbook("blast_runbook", "Blast radius runbook");
const mitigationRunbook = stubRunbook("mitigation_runbook", "Mitigation runbook");
const commsRunbook = stubRunbook("comms_runbook", "Comms draft runbook");
const standardRunbook = stubRunbook("standard_runbook", "Standard incident runbook");

const pageOncall = defineTool({
  name: "page_oncall",
  description: "Page the on-call rotation — irreversible.",
  tier: "dangerous",
  requiresApproval: true,
  input: z.object({ summary: z.string() }),
  run: () => ({ paged: true }),
});

export const incidentResponse = defineFlow("incident-response", "Incident response runbook", (f) => {
  const alert = f.json("alert");
  const severity = f.json("severity", SeveritySchema);
  const timeline = f.text("timeline");
  const blast = f.text("blast");
  const mitigation = f.text("mitigation");
  const comms = f.text("comms");
  const standard = f.text("standard_notes");
  const postmortem = f.json("postmortem", PostmortemSchema);
  const pageResult = f.json("page_result");

  const paging = f.resource("pager", "pagerduty", { scope: "session" });
  const out = f.output(pageResult);

  const triage = f
    .input({ schema: { alert } })
    .code(severityScore, { writeTo: severity })
    .switch({ on: severity.path("label"), cases: ["P0", "P1"] });

  const p0Barrier = f.join(
    [
      triage.on("P0").subflow(timelineRunbook, { writeTo: timeline }),
      triage.on("P0").subflow(blastRunbook, { writeTo: blast }),
      triage.on("P0").subflow(mitigationRunbook, { writeTo: mitigation }),
      triage.on("P0").subflow(commsRunbook, { writeTo: comms }),
    ],
    { mode: "quorum", count: 3 },
  );

  const p1Barrier = f.join(
    [
      triage.on("P1").subflow(timelineRunbook, { writeTo: timeline }),
      triage.on("P1").subflow(blastRunbook, { writeTo: blast }),
      triage.on("P1").subflow(mitigationRunbook, { writeTo: mitigation }),
      triage.on("P1").subflow(commsRunbook, { writeTo: comms }),
    ],
    { mode: "quorum", count: 3 },
  );

  const finish = (barrier: NodeHandle): void => {
    barrier
      .agent({
        model: anthropic("claude-sonnet-4-6"),
        output: PostmortemSchema,
        prompt: f.tpl`Synthesize postmortem from ${timeline}, ${blast}, ${mitigation}, ${comms}`,
        writeTo: postmortem,
      })
      .human({ mode: "approve", exits: ["approved", "needs_more", "false_alarm"] })
      .on("approved")
      .tool(pageOncall, { args: { summary: postmortem.path("summary") }, resource: paging, writeTo: pageResult })
      .to(out);
  };

  finish(p0Barrier);
  finish(p1Barrier);

  triage
    .on("default")
    .subflow(standardRunbook, { writeTo: standard })
    .agent({
      model: anthropic("claude-haiku-4-5"),
      output: PostmortemSchema,
      prompt: f.tpl`Summarize standard response using ${standard}`,
      writeTo: postmortem,
    })
    .human({ mode: "approve" })
    .on("approved")
    .tool(pageOncall, { args: { summary: postmortem.path("summary") }, resource: paging, writeTo: pageResult })
    .to(out);
});

if (isMain(import.meta.url)) printFlowReport(incidentResponse);
