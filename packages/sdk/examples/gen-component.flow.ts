import { anthropic, defineFlow } from "@construct/sdk";

/** Trivial subflow used as the `map` body in the Claude Design example. */
export const genComponent = defineFlow("gen_component", "Generate one component", (flow) => {
  const spec = flow.text("spec");
  const code = flow.json("code");
  flow.input({ channel: spec })
    .agent({ model: anthropic("claude-sonnet-4-6"), prompt: spec, writeTo: code })
    .to(flow.output(code));
});
