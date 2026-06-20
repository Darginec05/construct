import { z } from "zod";
import { anthropic, defineFlow } from "@construct/sdk";
import { isMain, printFlowReport } from "./_util.js";

/**
 * Launch announcement studio — a playground-friendly demo flow.
 *
 * Picked to show off the interesting control flow (agent → map fan-out → branch
 * with convergence) while staying inside what the in-editor Playground can drive
 * today: a single text input, no file uploads, and one model provider. Type a
 * one-line feature description into the composer and watch the graph light up.
 *
 *   input(brief)
 *     → plan (agent)                       — audience, angle, channels[]
 *     → map(per channel → channel-post)    — one draft per channel, collected
 *     → review (agent)                     — pass / score / notes
 *     → branch(review.pass):
 *          true  → output
 *          false → polish (agent, re-score) → output
 *
 * Both branch arms converge on the same Output node, so the run always ends with
 * one structured result regardless of the review verdict. Models are Anthropic;
 * swap `anthropic(...)` for `gemini(...)` / `openai(...)` to match the provider
 * key configured for the tenant.
 */

const PlanSchema = z.object({
  audience: z.string(),
  angle: z.string(),
  channels: z.array(z.string()).min(1).max(5),
});

const PostSchema = z.object({
  channel: z.string(),
  body: z.string(),
});

const ReviewSchema = z.object({
  pass: z.boolean(),
  score: z.number(),
  notes: z.array(z.string()),
});

/**
 * Per-channel body run once per channel by the `map` node. `map` seeds each
 * channel name as the `item` channel; the parent `plan` channel is visible too,
 * so a post is written with the campaign context in hand.
 */
const channelPost = defineFlow("channel-post", "Draft one channel post", (f) => {
  const item = f.text("item");
  const plan = f.json("plan", PlanSchema);
  const post = f.json("post", PostSchema);

  f.input({ schema: { item }, label: "Channel" })
    .agent({
      label: "Channel post writer",
      description: "Write one on-brand post for a single channel.",
      model: anthropic("claude-haiku-4-5"),
      output: PostSchema,
      prompt: f.tpl`Write a short, on-brand ${item} post for this launch plan: ${plan}.`,
      writeTo: post,
    })
    .to(f.output(post, { label: "Post" }));
});

export const launchAnnouncement = defineFlow(
  "launch-announcement",
  "Launch announcement studio",
  (f) => {
    const brief = f.text("brief");
    const plan = f.json("plan", PlanSchema);
    const posts = f.json("posts");
    const review = f.json("review", ReviewSchema);

    const out = f.output({ plan: plan.$, posts: posts.$, review: review.$ }, { label: "Campaign" });

    const planned = f.input({ schema: { brief }, label: "Feature brief" }).agent({
      label: "Campaign planner",
      description: "Pick the audience, angle, and channels for the launch.",
      model: anthropic("claude-sonnet-4-6"),
      output: PlanSchema,
      prompt: f.tpl`Plan a launch campaign for this feature: ${brief}. Choose the target audience, a positioning angle, and 2-4 social channels to announce on.`,
      writeTo: plan,
    });

    const reviewed = planned
      .map({
        label: "Per-channel posts",
        over: plan.path("channels"),
        body: channelPost,
        concurrency: 3,
        aggregate: "collect",
        writeTo: posts,
      })
      .agent({
        label: "Post reviewer",
        description: "Score the channel posts and flag weak ones.",
        model: anthropic("claude-sonnet-4-6"),
        output: ReviewSchema,
        prompt: f.tpl`Review these channel posts against the plan ${plan}: ${posts}. Score them 0-100 and flag anything off-brand or weak.`,
        writeTo: review,
      });

    const gate = reviewed.branch({ condition: review.path("pass"), label: "Review gate" });

    gate.on("true").to(out);
    gate
      .on("false")
      .agent({
        label: "Polish posts",
        description: "Apply the review notes and re-score the posts.",
        model: anthropic("claude-sonnet-4-6"),
        output: ReviewSchema,
        prompt: f.tpl`The posts ${posts} did not pass review. Apply the notes in ${review}, tighten the messaging, and re-score.`,
        writeTo: review,
      })
      .to(out);
  },
);

if (isMain(import.meta.url)) printFlowReport(launchAnnouncement);
