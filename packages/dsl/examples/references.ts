import { SCHEMA_VERSION, type Flow } from "../dist/index.js";

/**
 * Four production-shaped agent flows encoded in @construct/dsl, used as a stress
 * test of the contract. The first three are expected to validate cleanly; the
 * website-builder flow deliberately exercises edges the catalog does NOT yet
 * cover, so `validateFlow` should surface real gaps (see examples/stress.ts).
 */

// ---------------------------------------------------------------------------
// 1. airun — transactional CRM agent: prefilter → router → tool-loop → approval
// ---------------------------------------------------------------------------

export const airun: Flow = {
  schemaVersion: SCHEMA_VERSION,
  id: "airun",
  name: "airun CRM agent",
  channels: [
    { name: "message", type: "text", reducer: "lastValue" },
    { name: "route", type: "json", reducer: "lastValue" },
    { name: "intent", type: "json", reducer: "lastValue" },
    { name: "result", type: "json", reducer: "lastValue" },
  ],
  resources: [{ name: "crmdb", kind: "db", scope: "session", config: {} }],
  nodes: [
    { id: "in", type: "input", config: { schema: { message: "text" } } },
    {
      id: "prefilter",
      type: "code",
      config: { ref: "heuristicPrefilter", writeTo: "route" },
    },
    {
      id: "router",
      type: "router",
      config: {
        model: { provider: "anthropic", model: "claude-haiku-4-5" },
        prompt: "{{message}}",
        classes: [
          { name: "smalltalk", description: "Greetings, chit-chat, anything not a real request." },
          { name: "read", description: "Look up or read existing CRM records." },
          { name: "write", description: "Create or update a single CRM record." },
          { name: "bulk", description: "Changes that touch many records at once." },
          { name: "content", description: "Draft or edit copy, messages, or documents." },
          { name: "refuse", description: "Out-of-scope or disallowed requests." },
        ],
        writeTo: "intent",
      },
    },
    {
      id: "agent",
      type: "agent",
      config: {
        model: { provider: "anthropic", model: "claude-sonnet-4-6", cache: true },
        tools: ["crm_search", "crm_update_unit"],
        toolChoice: "auto",
        maxSteps: 8,
        writeTo: "result",
      },
    },
    {
      id: "apply",
      type: "tool",
      config: {
        tool: "crm_update_unit",
        args: { id: "$.result.targetId" },
        tier: "write",
        requiresApproval: true,
        resource: "crmdb",
        writeTo: "result",
      },
    },
    { id: "approve", type: "human", config: { mode: "approve", ttl: 3600 } },
    { id: "out", type: "output", config: { from: "$.result" } },
  ],
  edges: [
    { id: "e1", source: "in", target: "prefilter" },
    { id: "e2", source: "prefilter", target: "router" },
    { id: "e3", source: "router", target: "agent", sourceHandle: "read" },
    { id: "e4", source: "router", target: "apply", sourceHandle: "write" },
    { id: "e5", source: "apply", target: "approve" },
    { id: "e6", source: "approve", target: "out", sourceHandle: "approved" },
    { id: "e7", source: "agent", target: "out" },
  ],
  config: {},
  metadata: {},
};

// ---------------------------------------------------------------------------
// 2. Lovable-like — code agent: plan → parallel workers → build → reflect loop
// ---------------------------------------------------------------------------

export const lovable: Flow = {
  schemaVersion: SCHEMA_VERSION,
  id: "lovable",
  name: "Lovable-like code agent",
  channels: [
    { name: "prompt", type: "text", reducer: "lastValue" },
    { name: "plan", type: "json", reducer: "lastValue" },
    { name: "files", type: "file", reducer: "merge" },
    { name: "build", type: "json", reducer: "lastValue" },
  ],
  resources: [{ name: "sandbox", kind: "sandbox", scope: "run", config: {} }],
  nodes: [
    { id: "in", type: "input", config: { schema: { prompt: "text" } } },
    {
      id: "planner",
      type: "agent",
      config: {
        model: { provider: "anthropic", model: "claude-sonnet-4-6" },
        output: { schema: { tasks: "array" } },
        writeTo: "plan",
      },
    },
    {
      id: "workers",
      type: "map",
      config: {
        over: "$.plan.tasks",
        body: "worker_subflow",
        concurrency: 4,
        aggregate: "merge",
        writeTo: "files",
      },
    },
    {
      id: "build",
      type: "tool",
      config: {
        tool: "code_exec",
        args: { cmd: "build" },
        tier: "write",
        resource: "sandbox",
        writeTo: "build",
      },
    },
    {
      id: "reflect",
      type: "loop",
      config: {
        body: "fix_subflow",
        until: "$.build.ok",
        maxIterations: 5,
        writeTo: "files",
      },
    },
    { id: "approve", type: "human", config: { mode: "approve" } },
    { id: "out", type: "output", config: { from: "$.files" } },
  ],
  edges: [
    { id: "e1", source: "in", target: "planner" },
    { id: "e2", source: "planner", target: "workers" },
    { id: "e3", source: "workers", target: "build" },
    { id: "e4", source: "build", target: "reflect" },
    { id: "e5", source: "reflect", target: "approve" },
    { id: "e6", source: "approve", target: "out", sourceHandle: "approved" },
  ],
  config: {},
  metadata: {},
};

// ---------------------------------------------------------------------------
// 3. Claude Design — multimodal: ground → plan → variant fan-out → critique loop
// ---------------------------------------------------------------------------

export const claudeDesign: Flow = {
  schemaVersion: SCHEMA_VERSION,
  id: "claude-design",
  name: "Claude Design agent",
  channels: [
    { name: "brief", type: "text", reducer: "lastValue" },
    { name: "refs", type: "image", reducer: "append" },
    { name: "tokens", type: "json", reducer: "lastValue" },
    { name: "plan", type: "json", reducer: "lastValue" },
    { name: "candidates", type: "json", reducer: "append" },
    { name: "screenshot", type: "image", reducer: "lastValue" },
    { name: "critique", type: "json", reducer: "lastValue" },
  ],
  resources: [{ name: "figma", kind: "figma", scope: "session", config: {} }],
  nodes: [
    {
      id: "in",
      type: "input",
      config: { schema: { brief: "text", refs: "image" } },
    },
    {
      id: "ground",
      type: "retrieve",
      config: { store: "design-system", query: "{{brief}}", topK: 8, writeTo: "tokens" },
    },
    {
      id: "plan",
      type: "agent",
      config: {
        model: { provider: "anthropic", model: "claude-sonnet-4-6" },
        output: { schema: { components: "array" } },
        writeTo: "plan",
      },
    },
    {
      id: "variants",
      type: "map",
      config: {
        over: "$.plan.components",
        body: "gen_component",
        aggregate: "collect",
        writeTo: "candidates",
      },
    },
    {
      id: "render",
      type: "tool",
      config: {
        tool: "figma_render",
        args: { nodes: "$.candidates" },
        tier: "content",
        resource: "figma",
        writeTo: "screenshot",
      },
    },
    {
      id: "critic",
      type: "agent",
      config: {
        model: { provider: "anthropic", model: "claude-sonnet-4-6" },
        prompt: "Critique {{screenshot}} against {{tokens}}",
        output: { schema: { pass: "boolean", issues: "array" } },
        writeTo: "critique",
      },
    },
    { id: "gate", type: "branch", config: { condition: "$.critique.pass" } },
    { id: "pick", type: "human", config: { mode: "select" } },
    { id: "out", type: "output", config: { from: "$.candidates" } },
  ],
  edges: [
    { id: "e1", source: "in", target: "ground" },
    { id: "e2", source: "ground", target: "plan" },
    { id: "e3", source: "plan", target: "variants" },
    { id: "e4", source: "variants", target: "render" },
    { id: "e5", source: "render", target: "critic" },
    { id: "e6", source: "critic", target: "gate" },
    { id: "e7", source: "gate", target: "variants", sourceHandle: "false" },
    { id: "e8", source: "gate", target: "pick", sourceHandle: "true" },
    { id: "e9", source: "pick", target: "out", sourceHandle: "next" },
  ],
  config: {},
  metadata: {},
};

// ---------------------------------------------------------------------------
// 4. Website builder — the stress case. Deliberately uses capabilities the
//    catalog does NOT yet have, so validation should flag them:
//    (a) a multi-turn human Q&A intake  -> human mode "collect" (not in enum)
//    (b) a 3-way review gate with payload -> handle "changes" (not approve/reject)
//    (c) heterogeneous parallel + AND-join before build (no join primitive)
//    (d) dynamic orchestrator dispatch (task list invented at runtime)
// ---------------------------------------------------------------------------

export const websiteBuilder: Flow = {
  schemaVersion: SCHEMA_VERSION,
  id: "website-builder",
  name: "Website builder agent",
  channels: [
    { name: "brief", type: "text", reducer: "lastValue" },
    { name: "assets", type: "file", reducer: "append" },
    { name: "spec", type: "json", reducer: "lastValue" },
    { name: "routing", type: "json", reducer: "lastValue" },
    { name: "research", type: "json", reducer: "lastValue" },
    { name: "tokens", type: "json", reducer: "lastValue" },
    { name: "content", type: "json", reducer: "lastValue" },
    { name: "media", type: "file", reducer: "append" },
    { name: "files", type: "file", reducer: "merge" },
    { name: "preview", type: "text", reducer: "lastValue" },
    { name: "issues", type: "json", reducer: "lastValue" },
    { name: "feedback", type: "text", reducer: "lastValue" },
    { name: "deployUrl", type: "text", reducer: "lastValue" },
  ],
  resources: [
    { name: "sandbox", kind: "sandbox", scope: "run", config: {} },
    { name: "hosting", kind: "deploy", scope: "session", config: {} },
  ],
  nodes: [
    {
      id: "trigger",
      type: "input",
      config: { schema: { brief: "text", assets: "file" } },
    },
    // (a) conversational intake that loops question/answer until spec complete.
    {
      id: "intake",
      type: "human",
      config: { mode: "collect", prompt: "Clarify the brief", writeTo: "spec" },
    },
    // (d) router as deterministic flag-setting, then orchestrator dispatch.
    {
      id: "router",
      type: "transform",
      config: { expr: "computeRouting($.spec)", writeTo: "routing" },
    },
    {
      id: "orchestrator",
      type: "agent",
      config: {
        model: { provider: "anthropic", model: "claude-sonnet-4-6" },
        output: { schema: { tasks: "array" } },
        writeTo: "routing",
      },
    },
    // (c) heterogeneous parallel subagents that must all finish before build.
    { id: "research", type: "subflow", config: { flow: "research_agent", writeTo: "research" } },
    { id: "design", type: "subflow", config: { flow: "design_agent", writeTo: "tokens" } },
    { id: "contentSub", type: "subflow", config: { flow: "content_agent", writeTo: "content" } },
    { id: "asset", type: "subflow", config: { flow: "asset_agent", writeTo: "media" } },
    // (c) explicit AND barrier: build waits for all four subagents.
    { id: "barrier", type: "join", config: { mode: "all" } },
    { id: "buildSub", type: "subflow", config: { flow: "build_agent", writeTo: "files" } },
    {
      id: "render",
      type: "tool",
      config: {
        tool: "assemble_render",
        args: { files: "$.files" },
        tier: "write",
        resource: "sandbox",
        writeTo: "preview",
      },
    },
    {
      id: "validator",
      type: "agent",
      config: {
        model: { provider: "anthropic", model: "claude-sonnet-4-6" },
        prompt: "Check {{preview}} against {{spec}}",
        output: { schema: { pass: "boolean", issues: "array" } },
        writeTo: "issues",
      },
    },
    { id: "gate", type: "branch", config: { condition: "$.issues.pass" } },
    // (b) 3-way human review carrying free-text feedback.
    {
      id: "review",
      type: "human",
      config: {
        mode: "approve",
        exits: ["approved", "changes", "rejected"],
        writeTo: "feedback",
      },
    },
    {
      id: "deploy",
      type: "tool",
      config: {
        tool: "deploy_site",
        args: { files: "$.files" },
        tier: "dangerous",
        requiresApproval: true,
        resource: "hosting",
        writeTo: "deployUrl",
      },
    },
    { id: "out", type: "output", config: { from: "$.deployUrl" } },
  ],
  edges: [
    { id: "e1", source: "trigger", target: "intake" },
    { id: "e2", source: "intake", target: "router" },
    { id: "e3", source: "router", target: "orchestrator" },
    // fan-out to four independent subagents
    { id: "e4", source: "orchestrator", target: "research" },
    { id: "e5", source: "orchestrator", target: "design" },
    { id: "e6", source: "orchestrator", target: "contentSub" },
    { id: "e7", source: "orchestrator", target: "asset" },
    // AND barrier: build needs research + design tokens + content + assets
    { id: "e8", source: "research", target: "barrier" },
    { id: "e9", source: "design", target: "barrier" },
    { id: "e10", source: "contentSub", target: "barrier" },
    { id: "e11", source: "asset", target: "barrier" },
    { id: "e11b", source: "barrier", target: "buildSub" },
    { id: "e12", source: "buildSub", target: "render" },
    { id: "e13", source: "render", target: "validator" },
    { id: "e14", source: "validator", target: "gate" },
    { id: "e15", source: "gate", target: "orchestrator", sourceHandle: "false" },
    { id: "e16", source: "gate", target: "review", sourceHandle: "true" },
    // 3-way exits — "changes" handle does not exist on an approve gate
    { id: "e17", source: "review", target: "deploy", sourceHandle: "approved" },
    { id: "e18", source: "review", target: "orchestrator", sourceHandle: "changes" },
    { id: "e19", source: "review", target: "out", sourceHandle: "rejected" },
    { id: "e20", source: "deploy", target: "out" },
  ],
  config: {},
  metadata: {},
};

export const ALL_FLOWS = { airun, lovable, claudeDesign, websiteBuilder };
