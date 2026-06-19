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
 *   input(brief)                                  ← product + goal + monthly budget
 *     → strategy (AGENT, tools:[calculator])      — positioning, ICP, channel/budget split, KPIs
 *     → map(per channel → channel-plan subflow)   — concrete campaign plan per channel
 *     → execBrief (agent)                         — exec summary + 30-day plan + risks
 *     → output(strategy, channelPlans, execBrief)
 *
 * Stays inside what the in-editor Playground can drive today: a single text
 * input, no file uploads, and one model provider. `calculator` is key-free, so
 * the agentic loop runs without any tenant configuration. Models are Anthropic;
 * swap `anthropic(...)` for `gemini(...)` / `openai(...)` to match the tenant's
 * provider key. Type a one-line brief that includes a budget, e.g.
 * "B2B SaaS for HR onboarding, goal 100 demos/quarter, budget $30k/mo".
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

  f.input({ schema: { item } })
    .agent({
      model: anthropic("claude-haiku-4-5"),
      output: ChannelPlanSchema,
      prompt: f.tpl`Build a concrete campaign plan for the ${item} channel, consistent with the overall strategy ${strategy}. Cover the objective, target audience, 3-5 tactics, a posting cadence, and 2-3 sample copy lines.`,
      writeTo: plan,
    })
    .to(f.output(plan));
});

export const cmoStrategist = defineFlow("cmo-strategist", "CMO marketing strategist", (f) => {
  const brief = f.text("brief");
  const strategy = f.json("strategy", StrategySchema);
  const channelPlans = f.json("channelPlans", { reducer: "append" });
  const execBrief = f.json("execBrief", ExecBriefSchema);

  f.input({ schema: { brief } })
    .agent({
      model: anthropic("claude-sonnet-4-6"),
      tools: [calculator],
      toolChoice: "auto",
      maxSteps: 8,
      output: StrategySchema,
      system:
        "You are a pragmatic CMO. Design a go-to-market marketing strategy a small team can execute. Use the calculator to split the stated monthly budget across channels so the per-channel dollar amounts sum to the total exactly.",
      prompt: f.tpl`Brief: ${brief}

Produce the marketing strategy: positioning, the ideal customer profile, value props, a channel mix with budget split (both percent and monthly USD), and measurable KPIs.`,
      writeTo: strategy,
    })
    .map({
      over: strategy.path("channels"),
      body: channelPlan,
      concurrency: 3,
      aggregate: "collect",
      writeTo: channelPlans,
    })
    .agent({
      model: anthropic("claude-sonnet-4-6"),
      output: ExecBriefSchema,
      prompt: f.tpl`Synthesize an executive brief from the strategy ${strategy} and the per-channel plans ${channelPlans}: a headline, a short summary, a prioritized 30-day action list, and the key risks to watch.`,
      writeTo: execBrief,
    })
    .to(
      f.output({
        strategy: strategy.$,
        channelPlans: channelPlans.$,
        execBrief: execBrief.$,
      }),
    );
});

if (isMain(import.meta.url)) printFlowReport(cmoStrategist);
