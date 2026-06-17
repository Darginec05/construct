import { anthropic, defineFlow } from "@construct/sdk";
import { isMain, printFlowReport } from "./_util.js";

/**
 * Dynamic supervisor — stress case:
 *   map(tasks) → dispatch subflow (switch on type → specialist subflow)
 *   → join(all) → output
 */
const codeSpecialist = defineFlow("code_specialist", "Code task specialist", (f) => {
  const item = f.json("item");
  const result = f.json("result");
  f.input({ schema: { item } })
    .agent({
      model: anthropic("claude-sonnet-4-6"),
      prompt: item,
      writeTo: result,
    })
    .to(f.output(result));
});

const researchSpecialist = defineFlow("research_specialist", "Research task specialist", (f) => {
  const item = f.json("item");
  const docs = f.json("docs");
  const result = f.json("result");
  f.input({ schema: { item } })
    .retrieve({ store: "kb", query: item.path("query"), topK: 5, writeTo: docs })
    .agent({
      model: anthropic("claude-sonnet-4-6"),
      prompt: f.tpl`Answer using ${docs}: ${item}`,
      writeTo: result,
    })
    .to(f.output(result));
});

const generalist = defineFlow("generalist", "General task specialist", (f) => {
  const item = f.json("item");
  const result = f.json("result");
  f.input({ schema: { item } })
    .agent({
      model: anthropic("claude-haiku-4-5"),
      prompt: item,
      writeTo: result,
    })
    .to(f.output(result));
});

const dispatch = defineFlow("dispatch", "Dispatch one task", (f) => {
  const item = f.json("item");
  const result = f.json("result");
  const out = f.output(result);

  const route = f.input({ schema: { item } }).switch({
    on: item.path("type"),
    cases: ["code", "research"],
  });

  route.on("code").subflow(codeSpecialist, { writeTo: result }).to(out);
  route.on("research").subflow(researchSpecialist, { writeTo: result }).to(out);
  route.on("default").subflow(generalist, { writeTo: result }).to(out);
});

export const supervisor = defineFlow("supervisor", "Dynamic batch supervisor", (f) => {
  const tasks = f.json("tasks");
  const results = f.json("results", { reducer: "append" });

  const mapped = f
    .input({ schema: { tasks } })
    .map({
      over: tasks,
      body: dispatch,
      concurrency: 4,
      aggregate: "collect",
      writeTo: results,
    });

  f.join([mapped], { mode: "all" }).to(f.output(results));
});

if (isMain(import.meta.url)) printFlowReport(supervisor);
