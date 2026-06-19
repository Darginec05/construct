import { type Flow, validateFlow } from "@construct/dsl";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  anthropic,
  defineFlow,
  defineTool,
  type ChannelHandle,
} from "../src/index.js";

const errorsOf = (flow: Flow) =>
  validateFlow(flow).filter((i) => i.level === "error");

const nodeById = (flow: Flow, id: string) =>
  flow.nodes.find((n) => n.id === id);

describe("builder serialization", () => {
  it("declares channels with their type and reducer", () => {
    const flow = defineFlow("c", "c", (f) => {
      f.text("brief");
      f.json("plan", z.object({ x: z.number() }));
      f.image("refs", { reducer: "append" });
      f.file("files", { reducer: "merge" });
    }).toJSON();

    expect(flow.channels).toEqual([
      { name: "brief", type: "text", reducer: "lastValue" },
      { name: "plan", type: "json", reducer: "lastValue" },
      { name: "refs", type: "image", reducer: "append" },
      { name: "files", type: "file", reducer: "merge" },
    ]);
  });

  it("serializes channel handles: $.name as a value, {{name}} in templates, .path()", () => {
    let plan!: ChannelHandle;
    const flow = defineFlow("c", "c", (f) => {
      const brief = f.text("brief");
      plan = f.json("plan");
      const out = f.json("out");
      f.input({ channel: brief })
        .agent({
          model: anthropic("claude-sonnet-4-6"),
          prompt: f.tpl`Use ${brief}`,
          writeTo: out,
        })
        .transform({ expr: plan.path("tasks"), writeTo: out })
        .to(f.output(out));
    }).toJSON();

    const agent = nodeById(flow, "agent");
    expect(agent?.config.prompt).toBe("Use {{brief}}");
    expect(agent?.config.writeTo).toBe("out");
    expect(nodeById(flow, "transform")?.config.expr).toBe("$.plan.tasks");
    expect(plan.$).toBe("$.plan");
  });

  it("auto-wires edges and respects named handles via .on()", () => {
    const flow = defineFlow("c", "c", (f) => {
      const flag = f.json("flag");
      const out = f.json("out");
      const gate = f
        .input({ channel: flag })
        .branch({ condition: flag.path("ok") });
      gate.on("true").to(f.output(out));
      gate.on("false").transform({ expr: flag, writeTo: out }).to(f.output(out, { id: "out2" }));
    }).toJSON();

    const branchEdges = flow.edges.filter((e) => e.source === "branch");
    expect(branchEdges.map((e) => e.sourceHandle).sort()).toEqual(["false", "true"]);
    // the input -> branch edge carries no handle
    expect(flow.edges.find((e) => e.source === "input")?.sourceHandle).toBeUndefined();
    expect(errorsOf(flow)).toEqual([]);
  });

  it("inherits tier/requiresApproval from the tool and registers it", () => {
    const danger = defineTool({
      name: "wipe",
      description: "wipe",
      tier: "dangerous",
      requiresApproval: true,
      run: () => null,
    });
    const flow = defineFlow("c", "c", (f) => {
      const r = f.resource("box", "sandbox");
      const out = f.json("out");
      f.input()
        .tool(danger, { args: { id: f.json("x").path("id") }, resource: r, writeTo: out })
        .to(f.output(out));
    }).toJSON();

    const tool = nodeById(flow, "tool");
    expect(tool?.config.tool).toBe("wipe");
    expect(tool?.config.tier).toBe("dangerous");
    expect(tool?.config.requiresApproval).toBe(true);
    expect(tool?.config.resource).toBe("box");
    expect(tool?.config.args).toEqual({ id: "$.x.id" });
  });

  it("places join with mode, count, and multiple upstream handles", () => {
    const flow = defineFlow("c", "c", (f) => {
      const msg = f.text("msg");
      const intent = f.json("intent");
      const out = f.json("out");
      const router = f
        .input({ channel: msg })
        .router({
          model: anthropic("m"),
          classes: [{ name: "read" }, { name: "write" }],
          writeTo: intent,
        });
      f.join([router.on("read"), router.on("write")], {
        mode: "quorum",
        count: 2,
        writeTo: out,
      }).to(f.output(out));
    }).toJSON();

    const join = nodeById(flow, "join");
    expect(join?.config).toMatchObject({ mode: "quorum", count: 2, writeTo: "out" });
    expect(flow.edges.filter((e) => e.target === "join")).toHaveLength(2);
    expect(errorsOf(flow)).toEqual([]);
  });

  it("serializes switch cases and router fallback", () => {
    const flow = defineFlow("c", "c", (f) => {
      const kind = f.json("kind");
      const out = f.json("out");
      const gate = f.input({ channel: kind }).switch({ on: kind, cases: ["x", "y"] });
      gate.on("x").transform({ expr: kind, writeTo: out }).to(f.output(out, { id: "outX" }));
      gate.on("y").transform({ expr: kind, writeTo: out }).to(f.output(out, { id: "outY" }));

      f.input()
        .router({
          model: anthropic("m"),
          classes: [{ name: "a" }],
          fallback: true,
          writeTo: kind,
        })
        .to(f.output(out, { id: "outRouter" }));
    }).toJSON();

    expect(nodeById(flow, "router")?.config.fallback).toBe(true);
    expect(nodeById(flow, "switch")?.config).toMatchObject({
      on: "$.kind",
      cases: ["x", "y"],
    });
    expect(errorsOf(flow)).toEqual([]);
  });

  it("throws on duplicate explicit node ids", () => {
    expect(() =>
      defineFlow("c", "c", (f) => {
        const out = f.json("out");
        const first = f.input().transform({ expr: "1", writeTo: out, id: "dup" });
        first.transform({ expr: "2", writeTo: out, id: "dup" }).to(f.output(out));
      }),
    ).toThrow(/duplicate node id "dup"/);
  });

  it("declares resources and multi-field input schema", () => {
    const flow = defineFlow("c", "c", (f) => {
      const brief = f.text("brief");
      const refs = f.image("refs", { reducer: "append" });
      const figma = f.resource("figma", "figma", { scope: "session", config: { file: "abc" } });
      const out = f.json("out");
      f.input({ schema: { brief, refs } })
        .tool(
          defineTool({ name: "render", description: "r", tier: "content", run: () => null }),
          { resource: figma, writeTo: out },
        )
        .to(f.output(out));
    }).toJSON();

    expect(flow.resources).toEqual([
      { name: "figma", kind: "figma", scope: "session", config: { file: "abc" } },
    ]);
    expect(nodeById(flow, "input")?.config.schema).toEqual({
      brief: "text",
      refs: "image",
    });
    expect(errorsOf(flow)).toEqual([]);
  });

  it("wires subflow inputs and inline code nodes", () => {
    const body = defineFlow("body", "Body", (f) => {
      const v = f.json("v");
      f.input({ channel: v }).to(f.output(v));
    });
    const flow = defineFlow("c", "c", (f) => {
      const payload = f.json("payload");
      const out = f.json("out");
      f.input({ channel: payload })
        .subflow(body, { inputs: { v: payload.path("value") }, writeTo: out })
        .code("inline-ref", { inline: "return x", writeTo: out })
        .to(f.output(out));
    }).toJSON();

    expect(nodeById(flow, "subflow")?.config).toMatchObject({
      flow: "body",
      inputs: { v: "$.payload.value" },
      writeTo: "out",
    });
    expect(nodeById(flow, "code")?.config).toMatchObject({
      inline: "return x",
      writeTo: "out",
    });
    expect(errorsOf(flow)).toEqual([]);
  });

  it("converts a Zod agent output schema to JSON Schema", () => {
    const flow = defineFlow("c", "c", (f) => {
      const out = f.json("out");
      f.input()
        .agent({
          model: anthropic("m"),
          output: z.object({ tasks: z.array(z.string()) }),
          writeTo: out,
        })
        .to(f.output(out));
    }).toJSON();

    expect(nodeById(flow, "agent")?.config.output).toEqual({
      schema: {
        type: "object",
        properties: { tasks: { type: "array", items: { type: "string" } } },
        required: ["tasks"],
      },
    });
  });
});

describe("reference flows render to valid documents", () => {
  it("claude-design: retrieve -> map -> tool -> critic -> branch back-edge", () => {
    const genComponent = defineFlow("gen_component", "gen", (f) => {
      const spec = f.text("spec");
      const code = f.json("code");
      f.input({ channel: spec })
        .agent({ model: anthropic("m"), prompt: spec, writeTo: code })
        .to(f.output(code));
    });
    const figmaRender = defineTool({
      name: "figma_render",
      description: "render",
      tier: "content",
      run: () => ({ url: "x" }),
    });

    const claudeDesign = defineFlow("claude-design", "Claude Design agent", (f) => {
      const brief = f.text("brief");
      const refs = f.image("refs", { reducer: "append" });
      const tokens = f.json("tokens");
      const plan = f.json("plan");
      const candidates = f.json("candidates", { reducer: "append" });
      const screenshot = f.image("screenshot");
      const critique = f.json("critique");
      const figma = f.resource("figma", "figma", { scope: "session" });

      const variants = f
        .input({ schema: { brief, refs } })
        .retrieve({ store: "design-system", query: brief, topK: 8, writeTo: tokens })
        .agent({ model: anthropic("m"), output: z.object({ c: z.array(z.string()) }), writeTo: plan })
        .map({ over: plan.path("components"), body: genComponent, aggregate: "collect", writeTo: candidates });

      const gate = variants
        .tool(figmaRender, { args: { nodes: candidates }, resource: figma, writeTo: screenshot })
        .agent({
          model: anthropic("m"),
          prompt: f.tpl`Critique ${screenshot} against ${tokens}`,
          output: z.object({ pass: z.boolean() }),
          writeTo: critique,
        })
        .branch({ condition: critique.path("pass") });

      gate.on("false").to(variants);
      gate.on("true").human({ mode: "select" }).on("next").to(f.output(candidates));
    }).toJSON();

    expect(errorsOf(claudeDesign)).toEqual([]);
    // back-edge: branch "false" returns to the map node
    expect(
      claudeDesign.edges.some(
        (e) => e.source === "branch" && e.sourceHandle === "false" && e.target === "map",
      ),
    ).toBe(true);
    // human "select" exposes a "next" handle
    expect(
      claudeDesign.edges.some(
        (e) => e.source === "human" && e.sourceHandle === "next",
      ),
    ).toBe(true);
  });

  it("airun: router fork with two branches rejoining on a shared output", () => {
    const crmUpdate = defineTool({
      name: "crm_update",
      description: "update",
      tier: "write",
      run: () => null,
    });
    const airun = defineFlow("airun", "airun", (f) => {
      const message = f.text("message");
      const intent = f.json("intent");
      const result = f.json("result");
      f.resource("crmdb", "db", { scope: "session" });

      const router = f
        .input({ channel: message })
        .router({
          model: anthropic("claude-haiku-4-5"),
          prompt: message,
          classes: [{ name: "read" }, { name: "write" }],
          writeTo: intent,
        });

      const out = f.output(result);
      router.on("read").agent({ model: anthropic("m"), writeTo: result }).to(out);
      router
        .on("write")
        .tool(crmUpdate, { writeTo: result })
        .human({ mode: "approve", ttl: 3600 })
        .on("approved")
        .to(out);
    }).toJSON();

    expect(errorsOf(airun)).toEqual([]);
    // router class names become its output handles
    const routerEdges = airun.edges.filter((e) => e.source === "router");
    expect(routerEdges.map((e) => e.sourceHandle).sort()).toEqual(["read", "write"]);
    // both arms target the single output node
    const toOut = airun.edges.filter((e) => e.target === "output");
    expect(toOut).toHaveLength(2);
  });

  it("lovable: map + loop bodies are bundled as subflow ids", () => {
    const worker = defineFlow("worker", "worker", (f) => {
      const t = f.text("t");
      f.input({ channel: t }).to(f.output(t));
    });
    const fix = defineFlow("fix", "fix", (f) => {
      const t = f.text("t");
      f.input({ channel: t }).to(f.output(t));
    });
    const build = defineTool({
      name: "code_exec",
      description: "build",
      tier: "write",
      run: () => ({ ok: true }),
    });

    const lovable = defineFlow("lovable", "Lovable", (f) => {
      const plan = f.json("plan");
      const files = f.file("files", { reducer: "merge" });
      const buildCh = f.json("build");
      const box = f.resource("sandbox", "sandbox");

      f.input({ channel: f.text("prompt") })
        .agent({ model: anthropic("m"), output: z.object({ tasks: z.array(z.string()) }), writeTo: plan })
        .map({ over: plan.path("tasks"), body: worker, concurrency: 4, aggregate: "merge", writeTo: files })
        .tool(build, { args: { cmd: "build" }, resource: box, writeTo: buildCh })
        .loop({ body: fix, until: buildCh.path("ok"), maxIterations: 5, writeTo: files })
        .human({ mode: "approve" })
        .on("approved")
        .to(f.output(files));
    }).toJSON();

    expect(errorsOf(lovable)).toEqual([]);
    expect(nodeById(lovable, "map")?.config.body).toBe("worker");
    expect(nodeById(lovable, "loop")?.config.body).toBe("fix");
  });
});
