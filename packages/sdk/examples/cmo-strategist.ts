import { z } from "zod";
import { anthropic, defineFlow, defineTool } from "@construct/sdk";
import { isMain, printFlowReport } from "./_util.js";

/**
 * CMO marketing strategist — a genuinely useful, playground-friendly flow.
 *
 * Unlike the other examples (which use `agent` as a plain structured generator),
 * the first node here is a real *agentic* node: it is given the `calculator`
 * tool and a step budget, so the model loops — deciding a channel mix and using
 * the calculator to split the stated monthly budget into exact dollar amounts
 * that actually add up, instead of hallucinating the arithmetic. That is the
 * `agent = model + tool loop` shape, demonstrated on a real task.
 *
 * The strategy agent also *decides for itself* whether it has enough to work
 * with. Its structured output is tagged with a `status`: when the brief is
 * missing something essential (typically the monthly budget) it answers
 * `need_info` with a single, specific question instead of guessing; a human
 * collect step asks that question and loops the answer back into the agent.
 * Only once it answers `ready` does the flow fan out into per-channel plans.
 *
 *   input(brief)                                  ← product + goal + (maybe) budget
 *     → strategy (AGENT, tools:[calculator])      — status: ready | need_info
 *     → switch(status):
 *         need_info → human(collect: the agent's question) ─┐ (loop back)
 *                       └──────────────────────────────────→ strategy
 *         ready     → transform(lift strategy)
 *                       → map(per channel → channel-plan subflow)
 *                       → execBrief (agent)
 *                       → output(strategy, channelPlans, execBrief)
 *
 * Stays inside what the in-editor Playground can drive today: a single text
 * input, no file uploads, and one model provider. `calculator` is key-free, so
 * the agentic loop runs without any tenant configuration. Models are Anthropic;
 * swap `anthropic(...)` for `gemini(...)` / `openai(...)` to match the tenant's
 * provider key. Type a one-line brief — and try omitting the budget to see the
 * agent ask for it: "B2B SaaS for HR onboarding, goal 100 demos/quarter".
 */

const ChannelSchema = z.object({
  name: z.string(),
  budgetShare: z.number(),
  monthlyBudgetUsd: z.number(),
  rationale: z.string(),
});

const StrategySchema = z.object({
  positioning: z.string(),
  icp: z.object({
    segment: z.string(),
    painPoints: z.array(z.string()),
  }),
  valueProps: z.array(z.string()).min(1),
  channels: z.array(ChannelSchema).min(1).max(6),
  kpis: z.array(z.object({ metric: z.string(), target: z.string() })).min(1),
});

/**
 * The strategy agent's self-assessed output. `status` is the discriminant the
 * `switch` routes on: `ready` carries the full `strategy`; `need_info` carries a
 * single `question` to put to the user. Both payloads are optional because only
 * one is present per turn — a flat tag beats a Zod discriminated union here: a
 * structured agent answers through the `respond` tool, whose parameters must be a
 * top-level object. A union compiles to `anyOf`, which gets wrapped under a
 * `{ value: ... }` envelope and nested — a shape providers constrain far less
 * reliably than a plain object. The flat tag keeps the schema a clean top-level
 * object every provider honors.
 */
const StrategyDecisionSchema = z.object({
  status: z.enum(["ready", "need_info"]),
  question: z.string().optional(),
  strategy: StrategySchema.optional(),
});

const ChannelPlanSchema = z.object({
  channel: z.string(),
  objective: z.string(),
  audience: z.string(),
  tactics: z.array(z.string()).min(1),
  cadence: z.string(),
  sampleCopy: z.array(z.string()).min(1),
});

const ExecBriefSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  firstThirtyDays: z.array(z.string()).min(1),
  risks: z.array(z.string()),
});

/** Deterministic arithmetic for the agentic node's budget split (key-free). */
const calculator = defineTool({
  name: "calculator",
  description: "Evaluate a numeric arithmetic expression.",
  tier: "read",
  input: z.object({ expression: z.string() }),
  run: () => ({ expression: "", result: 0 }),
});

/**
 * Per-channel body run once per channel by the `map` node. `map` seeds each
 * channel object as the `item` channel; the parent `strategy` channel is visible
 * too, so a channel plan is written consistent with the overall strategy.
 */
const channelPlan = defineFlow("channel-plan", "Plan one marketing channel", (f) => {
  const item = f.json("item", ChannelSchema);
  const strategy = f.json("strategy", StrategySchema);
  const plan = f.json("plan", ChannelPlanSchema);

  f.input({ schema: { item }, label: "Channel" })
    .agent({
      label: "Channel planner",
      description: "Build a concrete campaign plan for one channel.",
      model: anthropic("claude-haiku-4-5"),
      output: ChannelPlanSchema,
      prompt: f.tpl`Build a concrete campaign plan for the ${item} channel, consistent with the overall strategy ${strategy}. Cover the objective, target audience, 3-5 tactics, a posting cadence, and 2-3 sample copy lines.`,
      writeTo: plan,
    })
    .to(f.output(plan, { label: "Channel plan" }));
});

export const cmoStrategist = defineFlow("cmo-strategist", "CMO marketing strategist", (f) => {
  const brief = f.text("brief");
  // The agent's tagged verdict (ready | need_info). Typed, so `.path("status")`
  // and `.path("strategy")` stay checked.
  const decision = f.json("decision", StrategyDecisionSchema);
  // The user's answer to a clarifying question; fed back into the agent's prompt.
  // `lastValue` keeps the most recent reply — enough for the budget round-trip.
  const clarification = f.text("clarification");
  const strategy = f.json("strategy", StrategySchema);
  const channelPlans = f.json("channelPlans");
  const execBrief = f.json("execBrief", ExecBriefSchema);

  const gtm = f.output(
    {
      strategy: strategy.$,
      channelPlans: channelPlans.$,
      execBrief: execBrief.$,
    },
    { label: "GTM plan" },
  );

  const gate = f
    .input({ schema: { brief }, label: "Marketing brief" })
    .agent({
      label: "Strategy agent",
      description: "Design the GTM strategy, or ask for what's missing.",
      model: anthropic("claude-sonnet-4-6"),
      tools: [calculator],
      toolChoice: "auto",
      maxSteps: 8,
      output: StrategyDecisionSchema,
      system:
        "You are a pragmatic CMO. Design a go-to-market marketing strategy a small team can execute. " +
        "If the brief is missing something essential you cannot reasonably assume — above all the monthly " +
        "budget — set status to 'need_info' and put a single, specific question in 'question'; do NOT guess " +
        "the budget. Otherwise set status to 'ready' and return the full strategy in 'strategy'. Use the " +
        "calculator to split the stated monthly budget across channels so the per-channel dollar amounts sum " +
        "to the total exactly.",
      prompt: f.tpl`Brief: ${brief}

Answers to earlier clarifying questions (may be empty): ${clarification}

Produce the marketing strategy — positioning, the ideal customer profile, value props, a channel mix with budget split (both percent and monthly USD), and measurable KPIs — or, if you are missing something essential, ask for it.`,
      writeTo: decision,
    });

  const route = gate.switch({
    on: decision.path("status"),
    cases: ["ready", "need_info"],
    label: "Have enough to plan?",
  });

  // Missing info: surface the agent's own question to the user, capture the
  // answer, and loop back so the agent re-runs with it. The `{{decision.question}}`
  // token is interpolated against run state when the pause is shown.
  const ask = route.on("need_info").human({
    mode: "collect",
    prompt: "{{decision.question}}",
    writeTo: clarification,
    label: "Ask the user",
  });
  ask.to(gate);
  // `status` is one of two values, so `default` is unreachable — but route it to
  // the same ask step rather than leave a dead end: an unrecognized verdict is
  // safer to clarify than to act on.
  route.on("default").to(ask);

  // Ready: lift the strategy out of the tagged verdict into its own channel, then
  // the rest of the flow proceeds exactly as before.
  route
    .on("ready")
    .transform({ expr: decision.path("strategy"), writeTo: strategy, label: "Use strategy" })
    .map({
      label: "Per-channel plans",
      over: strategy.path("channels"),
      body: channelPlan,
      concurrency: 3,
      aggregate: "collect",
      writeTo: channelPlans,
    })
    .agent({
      label: "Exec brief writer",
      description: "Synthesize the strategy and channel plans into an exec brief.",
      model: anthropic("claude-sonnet-4-6"),
      output: ExecBriefSchema,
      prompt: f.tpl`Synthesize an executive brief from the strategy ${strategy} and the per-channel plans ${channelPlans}: a headline, a short summary, a prioritized 30-day action list, and the key risks to watch.`,
      writeTo: execBrief,
    })
    .to(gtm);
});

if (isMain(import.meta.url)) printFlowReport(cmoStrategist);
