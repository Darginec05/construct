import { z, type ZodType } from "zod";
import {
  anthropic,
  defineFlow,
  defineTool,
  type ChannelHandle,
  type ExprInput,
  type FlowRef,
  type Tool,
} from "@construct/sdk";
import type { ModelRef } from "@construct/dsl";
import { isMain, printFlowReport } from "./_util.js";

/**
 * Real-estate CRM assistant — modeled on a production chat agent.
 *
 * Shape of the real system this mirrors:
 *   message → Haiku intent router → per-intent handling
 *     - read / content / file  → multi-step Sonnet agent with read-only tools
 *     - smalltalk / refuse      → cheap Haiku reply, no tools
 *     - write / bulk / agent    → propose a change, HUMAN approves, then apply
 *     - low confidence          → router emits its own clarifying question
 *                                 (clarifyTo) — no extra model call
 *
 * Per-intent budgets mirror the real gateway: smalltalk/refuse cap output at
 * 400 tokens; bulk/agent get a 32k window (a batch update carries large JSON);
 * everything else 4k. Multi-step agents cap at 8 tool-loop steps.
 *
 * Two deliberate omissions vs. the real service:
 *   - the heuristic pre-filter (regex fast-path before the router).
 *   - real data access — every tool is mocked. These read/write tools stand in
 *     for what will later be MCP servers; their `run` returns canned shapes so
 *     the flow validates and the wiring is exercised end to end.
 *
 * Gating note (the crux of the write/bulk/agent branches): a tool whose `tier`
 * is write/bulk/dangerous auto-gates and, with no approver wired, fail-safe-
 * denies. Here the approval gate lives on the `human` node, and the apply tools
 * run only AFTER it on the "approved" handle. So the apply tools are left
 * UNTIERED (ungated): re-gating them at the tool node would double-gate the
 * already-approved action. Read/content tools stay tiered — they never mutate.
 */

// --- mocked tools (MCP stand-ins) -------------------------------------------

const searchUnits = defineTool({
  name: "search_units",
  description: "Search property units by free-text query (city, price band, beds).",
  tier: "read",
  input: z.object({ query: z.string() }),
  run: ({ query }) => [
    { id: "unit_1042", title: `2BR near ${query}`, price: 245_000, status: "available" },
    { id: "unit_1077", title: `Studio near ${query}`, price: 160_000, status: "reserved" },
  ],
});

const searchLeads = defineTool({
  name: "search_leads",
  description: "Search CRM leads by name, stage, or assigned agent.",
  tier: "read",
  input: z.object({ query: z.string() }),
  run: ({ query }) => [
    { id: "lead_88", name: query, stage: "viewing_booked", budget: 250_000 },
  ],
});

const getProject = defineTool({
  name: "get_project",
  description: "Fetch a development project with its unit inventory summary.",
  tier: "read",
  input: z.object({ projectId: z.string() }),
  run: ({ projectId }) => ({ id: projectId, name: "Harbour Heights", units: 120, sold: 84 }),
});

const generateUnitDescription = defineTool({
  name: "generate_unit_description",
  description: "Draft marketing copy for a unit in a given tone.",
  tier: "content",
  input: z.object({ unitId: z.string(), tone: z.string().optional() }),
  run: ({ unitId, tone }) => ({
    unitId,
    copy: `A bright, well-appointed home (${tone ?? "neutral"} tone).`,
  }),
});

// Ungated on purpose — see the gating note in the file header. The human
// "approve" node upstream is the gate; this only executes the approved action.
const applyUnitUpdate = defineTool({
  name: "apply_unit_update",
  description: "Apply an already-approved update to a single unit.",
  input: z.object({ unitId: z.string(), fields: z.record(z.unknown()) }),
  run: ({ unitId }) => ({ unitId, status: "updated" }),
});

// Ungated on purpose — same reasoning as `applyUnitUpdate`.
const applyBulkUnitUpdate = defineTool({
  name: "apply_bulk_unit_update",
  description: "Apply an already-approved update across many matching units.",
  input: z.object({ filter: z.record(z.unknown()), fields: z.record(z.unknown()) }),
  run: () => ({ matched: 12, status: "updated" }),
});

const readTools: Tool[] = [searchUnits, searchLeads, getProject];

// Per-intent models — name carries the output-token budget (airun's
// `maxOutputTokens`). Router stays plain Haiku (it caps itself internally).
const haiku = anthropic("claude-haiku-4-5");
const haikuShort = anthropic("claude-haiku-4-5", { maxTokens: 400 });
const sonnetStd = anthropic("claude-sonnet-4-6", { maxTokens: 4_000 });
const sonnetBulk = anthropic("claude-sonnet-4-6", { maxTokens: 32_000 });

const MAX_STEPS = 8;

// --- human-gated approval subflow (write / bulk / agent) --------------------

const UpdateProposalSchema = z.object({
  unitId: z.string(),
  fields: z.record(z.unknown()),
  summary: z.string(),
});

const BulkProposalSchema = z.object({
  filter: z.record(z.unknown()),
  fields: z.record(z.unknown()),
  summary: z.string(),
});

interface ApprovalFlowSpec {
  id: string;
  name: string;
  model: ModelRef;
  plannerSystem: string;
  /** Read/content tools the planner uses to research the proposal. */
  plannerTools: Tool[];
  proposalSchema: ZodType;
  /** Ungated executor that applies the approved proposal. */
  applyTool: Tool;
  applyArgs: (proposal: ChannelHandle) => Record<string, ExprInput>;
  approvePrompt: string;
  cancelledText: string;
}

/**
 * Build one "research → propose → human approve → apply" subflow. The planner
 * agent only reads; the gated action is the `human` node; the apply tool runs
 * ungated on the "approved" handle. Mirrors the resolveDiff/applyDiff split of
 * the real gateway, where the turn halts on a proposal and the apply happens
 * out of band once the user confirms.
 */
function defineApprovalFlow(spec: ApprovalFlowSpec): FlowRef {
  return defineFlow(spec.id, spec.name, (f) => {
    const message = f.text("message");
    const proposal = f.json("proposal", spec.proposalSchema);
    const result = f.text("result");

    const out = f.output(result, { label: "Result" });

    const gate = f
      .input({ schema: { message }, label: "Request" })
      .agent({
        label: "Planner",
        description: "Research the request and propose a concrete change. Do not mutate.",
        model: spec.model,
        system: spec.plannerSystem,
        prompt: f.tpl`${message}`,
        tools: spec.plannerTools,
        output: spec.proposalSchema,
        maxSteps: MAX_STEPS,
        writeTo: proposal,
      })
      .human({
        mode: "approve",
        prompt: spec.approvePrompt,
        exits: ["approved", "rejected"],
        ttl: 86_400,
        label: "Approve",
      });

    gate
      .on("approved")
      .tool(spec.applyTool, {
        args: spec.applyArgs(proposal),
        writeTo: result,
        label: "Apply",
      })
      .to(out);

    gate
      .on("rejected")
      .transform({ expr: spec.cancelledText, writeTo: result, label: "Cancelled" })
      .to(out);
  });
}

const writeApproval = defineApprovalFlow({
  id: "re_write_approval",
  name: "Single-unit write approval",
  model: sonnetStd,
  plannerSystem: "Turn the user's request into a single concrete unit update. Do not mutate anything.",
  plannerTools: [searchUnits, getProject],
  proposalSchema: UpdateProposalSchema,
  applyTool: applyUnitUpdate,
  applyArgs: (p) => ({ unitId: p.path("unitId"), fields: p.path("fields") }),
  approvePrompt: "Apply this unit update?",
  cancelledText: "Update cancelled.",
});

const bulkApproval = defineApprovalFlow({
  id: "re_bulk_approval",
  name: "Bulk write approval",
  model: sonnetBulk,
  plannerSystem: "Turn the request into a bulk update: a unit filter and the fields to change. Do not mutate anything.",
  plannerTools: [searchUnits, searchLeads],
  proposalSchema: BulkProposalSchema,
  applyTool: applyBulkUnitUpdate,
  applyArgs: (p) => ({ filter: p.path("filter"), fields: p.path("fields") }),
  approvePrompt: "Apply this bulk update?",
  cancelledText: "Bulk update cancelled.",
});

// The "agent" intent is the full kit: multi-step research across read AND
// content tools, ending in one approved batch. Same durable gate as bulk, but a
// richer toolset and a planner brief that expects several research steps.
const agentApproval = defineApprovalFlow({
  id: "re_agent_approval",
  name: "Agentic write approval",
  model: sonnetBulk,
  plannerSystem:
    "Plan a multi-step change. Research with the read and content tools across as many steps as needed, then propose a single batch update. Do not mutate anything.",
  plannerTools: [searchUnits, searchLeads, getProject, generateUnitDescription],
  proposalSchema: BulkProposalSchema,
  applyTool: applyBulkUnitUpdate,
  applyArgs: (p) => ({ filter: p.path("filter"), fields: p.path("fields") }),
  approvePrompt: "Apply this plan?",
  cancelledText: "Plan cancelled.",
});

// --- top-level flow ---------------------------------------------------------

export const realEstateCrmAgent = defineFlow(
  "real-estate-crm-agent",
  "Real-estate CRM agent",
  (f) => {
    const message = f.text("message");
    const intent = f.text("intent");
    const reply = f.text("reply");

    const out = f.output(reply, { label: "Reply" });

    const router = f
      .input({ schema: { message }, label: "User message" })
      .router({
        label: "Intent router",
        model: haiku,
        prompt: f.tpl`${message}`,
        writeTo: intent,
        fallback: true,
        // On an ambiguous input the router routes to "fallback" AND writes a
        // clarifying question to `reply` in the same call — no extra model call.
        clarifyTo: reply,
        classes: [
          { name: "smalltalk", description: "Greetings, thanks, chit-chat with no task." },
          { name: "read", description: "Look up units, leads, or projects." },
          { name: "content", description: "Draft or rewrite marketing copy." },
          { name: "file", description: "Questions about an attached document or image." },
          { name: "write", description: "Change a single unit or lead." },
          { name: "bulk", description: "Change many units or leads at once." },
          // Single-handle routers can't fire several branches, so requests that
          // combine capabilities (e.g. rewrite copy AND bulk-update) — what a
          // multi-label router would tag with secondary intents — route here:
          // the full-kit branch carries read + content tools and applies a batch.
          { name: "agent", description: "Multi-step task, or one that combines capabilities (e.g. rewrite copy and bulk-update), ending in a change." },
          { name: "refuse", description: "Out-of-scope or disallowed request." },
        ],
      });

    // Direct, read-only answers — multi-step Sonnet, no approval needed.
    router
      .on("read")
      .agent({
        label: "Read agent",
        model: sonnetStd,
        system: "Answer using the read tools. Never claim to have changed anything.",
        prompt: f.tpl`${message}`,
        tools: readTools,
        maxSteps: MAX_STEPS,
        writeTo: reply,
      })
      .to(out);

    router
      .on("content")
      .agent({
        label: "Content agent",
        model: sonnetStd,
        system: "Draft listing copy. Use read tools for facts; generate the description.",
        prompt: f.tpl`${message}`,
        tools: [...readTools, generateUnitDescription],
        maxSteps: MAX_STEPS,
        writeTo: reply,
      })
      .to(out);

    router
      .on("file")
      .agent({
        label: "File agent",
        model: sonnetStd,
        system: "Answer questions about the attached document using read tools only.",
        prompt: f.tpl`${message}`,
        tools: readTools,
        maxSteps: MAX_STEPS,
        writeTo: reply,
      })
      .to(out);

    // Cheap, tool-free replies — capped at 400 output tokens.
    router
      .on("smalltalk")
      .agent({
        label: "Smalltalk",
        model: haikuShort,
        system: "Reply briefly and warmly. No tools.",
        prompt: f.tpl`${message}`,
        writeTo: reply,
      })
      .to(out);

    router
      .on("refuse")
      .agent({
        label: "Refusal",
        model: haikuShort,
        system: "Politely decline out-of-scope requests in one sentence.",
        prompt: f.tpl`${message}`,
        writeTo: reply,
      })
      .to(out);

    // Low confidence / no clear match — the router already wrote a clarifying
    // question to `reply` (clarifyTo), so this branch just surfaces it.
    router.on("fallback").to(out);

    // Mutations go through a human-gated approval subflow.
    router
      .on("write")
      .subflow(writeApproval, { inputs: { message }, writeTo: reply, label: "Write approval" })
      .to(out);

    router
      .on("bulk")
      .subflow(bulkApproval, { inputs: { message }, writeTo: reply, label: "Bulk approval" })
      .to(out);

    router
      .on("agent")
      .subflow(agentApproval, { inputs: { message }, writeTo: reply, label: "Agentic approval" })
      .to(out);
  },
);

if (isMain(import.meta.url)) printFlowReport(realEstateCrmAgent);
