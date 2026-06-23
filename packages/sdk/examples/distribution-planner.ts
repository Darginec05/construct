import { z } from "zod";
import { anthropic, defineFlow } from "@construct/sdk";
import { isMain, printFlowReport } from "./_util.js";

/**
 * Distribution Planner Studio — a GTM / distribution planning demo flow.
 *
 * Turns a free-form project prompt into a full distribution plan: strategy,
 * per-phase playbooks, per-channel playbooks, a week-by-week calendar, KPIs,
 * and a quality gate with optional refinement.
 *
 *   input(prompt)
 *     → intake (agent)                         — ProjectBrief
 *     → strategy (agent)                       — positioning, phases[], channels[]
 *     → map(phases → phase-playbook)           — PhasePlan[] collected
 *     → synthesis (agent)                      — cross-phase narrative
 *     → map(channels → channel-playbook)       — ChannelPlan[] collected
 *     → merge (agent)                          — calendar, metrics, executiveSummary
 *     → review (agent)                         — pass / score / gaps
 *     → branch(review.pass):
 *          true  → output
 *          false → refine (agent) → output
 *
 * Playground-friendly: one text input, Anthropic models only. Swap model helpers
 * to match the provider key configured for the tenant.
 */

const ProjectBriefSchema = z.object({
  productName: z.string(),
  category: z.string(),
  stage: z.enum(["idea", "mvp", "pre-launch", "launch", "growth"]),
  icp: z.string(),
  geography: z.string(),
  budgetTier: z.enum(["bootstrap", "mid", "enterprise"]),
  constraints: z.array(z.string()).max(8),
  rawPrompt: z.string(),
});

const PhaseRefSchema = z.object({
  name: z.string(),
  durationWeeks: z.number(),
  objective: z.string(),
});

const StrategySchema = z.object({
  positioning: z.string(),
  icp: z.string(),
  motion: z.enum(["plg", "sales-led", "community-led", "hybrid"]),
  primaryGoal: z.enum(["awareness", "activation", "revenue"]),
  horizonWeeks: z.number(),
  phases: z.array(PhaseRefSchema).min(2).max(4),
  channels: z.array(z.string()).min(3).max(8),
});

const TacticSchema = z.object({
  title: z.string(),
  channel: z.string(),
  action: z.string(),
  owner: z.enum(["founder", "marketing", "community", "agency"]),
  effort: z.enum(["S", "M", "L"]),
  kpi: z.string(),
});

const PhasePlanSchema = z.object({
  phase: z.string(),
  durationWeeks: z.number(),
  objective: z.string(),
  tactics: z.array(TacticSchema).min(2).max(8),
  milestones: z.array(z.string()).min(1).max(5),
  risks: z.array(z.string()).max(4),
});

const ChannelPlanSchema = z.object({
  channel: z.string(),
  role: z.enum(["awareness", "activation", "retention", "social-proof"]),
  cadence: z.string(),
  tactics: z.array(z.string()).min(2).max(6),
  sampleHooks: z.array(z.string()).min(2).max(3),
  assetsNeeded: z.array(z.string()).max(5),
  budgetHint: z.enum(["free", "low", "medium"]),
  successMetric: z.string(),
});

const SynthesisSchema = z.object({
  narrative: z.string(),
  crossPhaseThemes: z.array(z.string()).min(1).max(6),
});

const WeekPlanSchema = z.object({
  week: z.number(),
  theme: z.string(),
  actions: z.array(z.string()).min(1).max(6),
});

const MetricPlanSchema = z.object({
  name: z.string(),
  target: z.string(),
  phase: z.string().optional(),
  channel: z.string().optional(),
});

const MergePlanSchema = z.object({
  calendar: z.array(WeekPlanSchema).min(1).max(16),
  metrics: z.array(MetricPlanSchema).min(3).max(12),
  executiveSummary: z.string(),
});

const ReviewSchema = z.object({
  pass: z.boolean(),
  score: z.number(),
  gaps: z.array(z.string()),
  notes: z.array(z.string()),
});

/** One phase from `strategy.phases` — expanded into tactics, milestones, risks. */
const phasePlaybook = defineFlow("phase-playbook", "Phase playbook", (f) => {
  const item = f.json("item", PhaseRefSchema);
  const brief = f.json("brief", ProjectBriefSchema);
  const strategy = f.json("strategy", StrategySchema);
  const phasePlan = f.json("phasePlan", PhasePlanSchema);

  f.input({ schema: { item }, label: "Phase" }).agent({
    label: "Phase planner",
    description: "Expand one GTM phase into concrete tactics and milestones.",
    model: anthropic("claude-haiku-4-5"),
    output: PhasePlanSchema,
    prompt: f.tpl`Build a distribution playbook for phase "${item.path("name")}" (${item.path("durationWeeks")} weeks, objective: ${item.path("objective")}).

Product brief: ${brief}
Strategy: ${strategy}

Return tactics with clear owners, effort (S/M/L), and KPIs. Include milestones and risks.`,
    writeTo: phasePlan,
  }).to(f.output(phasePlan, { label: "Phase plan" }));
});

/** One channel from `strategy.channels` — cadence, hooks, assets, metric. */
const channelPlaybook = defineFlow("channel-playbook", "Channel playbook", (f) => {
  const item = f.text("item");
  const brief = f.json("brief", ProjectBriefSchema);
  const strategy = f.json("strategy", StrategySchema);
  const phasePlans = f.json("phasePlans");
  const channelPlan = f.json("channelPlan", ChannelPlanSchema);

  f.input({ schema: { item }, label: "Channel" }).agent({
    label: "Channel planner",
    description: "Deep dive on one distribution channel.",
    model: anthropic("claude-haiku-4-5"),
    output: ChannelPlanSchema,
    prompt: f.tpl`Build a channel playbook for "${item}".

Product brief: ${brief}
Strategy: ${strategy}
Phase playbooks already drafted: ${phasePlans}

Cover cadence, concrete tactics, 2-3 sample hooks (not full copy), assets needed, budget hint, and a success metric.`,
    writeTo: channelPlan,
  }).to(f.output(channelPlan, { label: "Channel plan" }));
});

export const distributionPlanner = defineFlow(
  "distribution-planner",
  "Distribution Planner Studio",
  (f) => {
    const prompt = f.text("prompt");
    const brief = f.json("brief", ProjectBriefSchema);
    const strategy = f.json("strategy", StrategySchema);
    const phasePlans = f.json("phasePlans");
    const synthesis = f.json("synthesis", SynthesisSchema);
    const channelPlans = f.json("channelPlans");
    const mergePlan = f.json("mergePlan", MergePlanSchema);
    const review = f.json("review", ReviewSchema);

    const out = f.output(
      {
        brief: brief.$,
        strategy: strategy.$,
        phases: phasePlans.$,
        channels: channelPlans.$,
        calendar: mergePlan.path("calendar"),
        metrics: mergePlan.path("metrics"),
        executiveSummary: mergePlan.path("executiveSummary"),
        review: review.$,
      },
      { label: "Distribution plan" },
    );

    const intaken = f.input({ schema: { prompt }, label: "Project prompt" }).agent({
      label: "Project intake",
      description: "Normalize the prompt into a structured project brief.",
      model: anthropic("claude-sonnet-4-6"),
      output: ProjectBriefSchema,
      prompt: f.tpl`Extract a structured project brief from this prompt. Preserve the original text in rawPrompt.

Prompt: ${prompt}`,
      writeTo: brief,
    });

    const strategized = intaken.agent({
      label: "GTM strategist",
      description: "Define positioning, motion, phases, and priority channels.",
      model: anthropic("claude-sonnet-4-6"),
      output: StrategySchema,
      prompt: f.tpl`Create a go-to-market strategy for ${brief.path("productName")}.

Brief: ${brief}

Pick 2-4 phases spanning the planning horizon, and 3-8 concrete distribution channels matched to budget (${brief.path("budgetTier")}) and motion.`,
      writeTo: strategy,
    });

    const phased = strategized.map({
      label: "Phase playbooks",
      over: strategy.path("phases"),
      body: phasePlaybook,
      concurrency: 3,
      aggregate: "collect",
      writeTo: phasePlans,
    });

    const synthesized = phased.agent({
      label: "Cross-phase synthesis",
      description: "Connect phase playbooks into one narrative thread.",
      model: anthropic("claude-sonnet-4-6"),
      output: SynthesisSchema,
      prompt: f.tpl`Synthesize the phase playbooks into a coherent story.

Brief: ${brief}
Strategy: ${strategy}
Phase playbooks: ${phasePlans}`,
      writeTo: synthesis,
    });

    const channeled = synthesized.map({
      label: "Channel playbooks",
      over: strategy.path("channels"),
      body: channelPlaybook,
      concurrency: 4,
      aggregate: "collect",
      writeTo: channelPlans,
    });

    const merged = channeled.agent({
      label: "Plan merger",
      description: "Build calendar, KPIs, and executive summary from all playbooks.",
      model: anthropic("claude-sonnet-4-6"),
      output: MergePlanSchema,
      prompt: f.tpl`Merge the distribution plan into an executable calendar and KPI set.

Brief: ${brief}
Strategy: ${strategy}
Synthesis: ${synthesis}
Phase playbooks: ${phasePlans}
Channel playbooks: ${channelPlans}

Calendar should cover ${strategy.path("horizonWeeks")} weeks (one entry per week). Metrics should tie to phases and channels.`,
      writeTo: mergePlan,
    });

    const reviewed = merged.agent({
      label: "Plan reviewer",
      description: "Score completeness and flag gaps before delivery.",
      model: anthropic("claude-sonnet-4-6"),
      output: ReviewSchema,
      prompt: f.tpl`Review this distribution plan for completeness and actionability.

Brief: ${brief}
Strategy: ${strategy}
Phase playbooks: ${phasePlans}
Channel playbooks: ${channelPlans}
Calendar & metrics: ${mergePlan}

Score 0-100. Set pass=true only if phases, channels, calendar, and KPIs are all covered with no major gaps. List specific gaps when pass=false.`,
      writeTo: review,
    });

    const gate = reviewed.branch({ condition: review.path("pass"), label: "Quality gate" });

    gate.on("true").to(out);
    gate
      .on("false")
      .agent({
        label: "Plan refiner",
        description: "Fix calendar, metrics, and summary gaps flagged in review.",
        model: anthropic("claude-sonnet-4-6"),
        output: MergePlanSchema,
        prompt: f.tpl`The distribution plan did not pass review.

Review: ${review}
Current plan: ${mergePlan}
Phase playbooks: ${phasePlans}
Channel playbooks: ${channelPlans}

Fix the gaps — update calendar, metrics, and executiveSummary. Keep what already works.`,
        writeTo: mergePlan,
      })
      .to(out);
  },
);

if (isMain(import.meta.url)) printFlowReport(distributionPlanner);
