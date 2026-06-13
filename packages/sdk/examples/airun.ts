import { z } from "zod";
import { anthropic, defineFlow, defineNode, defineTool } from "@construct/sdk";

/**
 * The airun CRM agent, authored with the fluent SDK:
 *   prefilter -> route -> (read: tool-loop | write: gated tool -> approval).
 * The router's class names become its output handles, so `router.on("read")`
 * and `router.on("write")` fork the graph; both arms rejoin on one output node.
 */

const IntentSchema = z.object({ class: z.string() });
const ResultSchema = z.object({ targetId: z.string() });

/** Cheap deterministic gate that runs before the model — a `code` node. */
const heuristicPrefilter = defineNode({
  id: "heuristicPrefilter",
  run: () => ({ allow: true }),
});

const crmSearch = defineTool({
  name: "crm_search",
  description: "Search CRM records (read-only).",
  tier: "read",
  input: z.object({ query: z.string() }),
  run: () => [],
});

const crmUpdateUnit = defineTool({
  name: "crm_update_unit",
  description: "Mutate a CRM unit — gated behind approval.",
  tier: "write",
  requiresApproval: true,
  input: z.object({ id: z.string() }),
  run: () => ({ ok: true }),
});

export const airun = defineFlow("airun", "airun CRM agent", (flow) => {
  const message = flow.text("message");
  const route = flow.json("route");
  const intent = flow.json("intent", IntentSchema);
  const result = flow.json("result", ResultSchema);

  const crmdb = flow.resource("crmdb", "db", { scope: "session" });

  const router = flow
    .input({ channel: message })
    .code(heuristicPrefilter, { writeTo: route })
    .router({
      model: anthropic("claude-haiku-4-5"),
      prompt: message,
      classes: [
        { name: "smalltalk", description: "Greetings, chit-chat, anything not a real request." },
        { name: "read", description: "Look up or read existing CRM records." },
        { name: "write", description: "Create or update a single CRM record." },
        { name: "bulk", description: "Changes that touch many records at once." },
        { name: "content", description: "Draft or edit copy, messages, or documents." },
        { name: "refuse", description: "Out-of-scope or disallowed requests." },
      ],
      writeTo: intent,
    });

  const out = flow.output(result);

  router
    .on("read")
    .agent({
      model: anthropic("claude-sonnet-4-6", { cache: true }),
      tools: [crmSearch, crmUpdateUnit],
      toolChoice: "auto",
      maxSteps: 8,
      writeTo: result,
    })
    .to(out);

  router
    .on("write")
    .tool(crmUpdateUnit, {
      args: { id: result.path("targetId") },
      resource: crmdb,
      writeTo: result,
    })
    .human({ mode: "approve", ttl: 3600 })
    .on("approved")
    .to(out);
});

console.log(JSON.stringify(airun.toJSON(), null, 2));
