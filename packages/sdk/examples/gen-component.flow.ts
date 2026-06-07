import { anthropic, defineFlow } from "construct";

/** Trivial subflow used as the `map` body in the Claude Design example. */
export const genComponent = defineFlow("gen_component", "Generate one component", (f) => {
  const spec = f.text("spec");
  const code = f.json("code");
  f.input({ channel: spec })
    .agent({ model: anthropic("claude-sonnet-4-6"), prompt: spec, writeTo: code })
    .to(f.output(code));
});
