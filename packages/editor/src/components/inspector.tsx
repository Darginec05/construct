import type { ValidationIssue } from "@construct/dsl";
import { AlertTriangle, CircleAlert } from "lucide-react";
import { CATEGORY_META, catalogEntry } from "../lib/catalog.ts";
import { EXPR_PLACEHOLDER, GENERIC_HINTS, fieldLabel } from "../lib/labels.ts";
import { describeSchema, type FieldSpec } from "../lib/zod-introspect.ts";
import { useValidation } from "../flow/validation-context.tsx";
import { useWorkspace } from "../flow/workspace-context.tsx";
import { FieldControl, type FlowRef } from "./inspector-fields.tsx";

/** Node-specific help, keyed by `${nodeType}.${fieldKey}`. Generic per-key help lives in labels.ts. */
const HINTS: Record<string, string> = {
  "agent.tools": "The model chooses among these at runtime.",
  "agent.toolChoice": "auto calls tools as needed; required forces one; none disables.",
  "agent.maxSteps": "Caps the tool-use loop before force-close.",
  "agent.output": "text returns prose; structured forces a JSON schema.",
  "classifier.classes": "Each class becomes an output handle.",
  "switch.cases": "Each case becomes an output handle (plus default).",
  "switch.on": EXPR_PLACEHOLDER,
  "join.count": "Only used when mode is quorum.",
  "tool.tier": "read/content auto-run; write/bulk/dangerous route through a Human node.",
  "tool.requiresApproval": "Pause for a human before running.",
  "tool.tool": "No tool registry in this build — enter the tool id.",
  "human.exits": "Custom output handles; overrides the mode defaults.",
  "human.mode": "Picks the pause type and its default output handles.",
  "input.schema": "field → data type",
  "output.from": "single returns one value; bundle returns a named record.",
  "retrieve.store": "No store registry in this build — enter the store id.",
  "code.ref": "Pair with Inline source — a code node needs one of the two.",
  "code.inline": "Pair with Handler ref — a code node needs one of the two.",
};

function isEmpty(value: unknown): boolean {
  if (value == null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

export function Inspector() {
  const { selectedNode, updateNodeConfig, flows, activeFlowId } = useWorkspace();
  const { issuesByNode } = useValidation();

  if (!selectedNode) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-muted-foreground">
        Select a node to edit its configuration.
      </div>
    );
  }

  const type = selectedNode.data.type;
  const entry = catalogEntry(type);
  const fields = entry ? describeSchema(entry.spec.configSchema) : [];
  const config = selectedNode.data.config;
  const flowRefs: FlowRef[] = flows
    .filter((f) => f.id !== activeFlowId)
    .map((f) => ({ id: f.id, name: f.name }));

  const Icon = entry?.icon;
  const cat = entry ? CATEGORY_META[entry.category] : undefined;
  const nodeIssues = issuesByNode[selectedNode.id] ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2.5">
          {Icon && cat ? (
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white"
              style={{ background: `hsl(var(${cat.hueVar}))` }}
            >
              <Icon size={17} />
            </div>
          ) : null}
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold">{entry?.label ?? type}</div>
            <div className="text-[11px] text-muted-foreground">
              {cat ? `${cat.label} · ` : ""}
              <span className="font-mono">{type}</span>
            </div>
          </div>
        </div>
        {entry?.description ? (
          <div className="mt-2 text-[12px] leading-snug text-muted-foreground">{entry.description}</div>
        ) : null}
        <div className="mt-1.5 font-mono text-[10px] text-muted-foreground/70">{selectedNode.id}</div>
      </div>
      <div className="flex-1 space-y-3.5 overflow-y-auto p-4">
        {nodeIssues.length > 0 ? <IssueList issues={nodeIssues} /> : null}
        {fields.length === 0 ? (
          <div className="text-[13px] text-muted-foreground">No configurable fields.</div>
        ) : (
          fields.map((spec) => (
            <FieldRow
              key={spec.key}
              spec={spec}
              value={config[spec.key]}
              hint={HINTS[`${type}.${spec.key}`] ?? GENERIC_HINTS[spec.key]}
              nodeId={selectedNode.id}
              flows={flowRefs}
              onUpdate={updateNodeConfig}
            />
          ))
        )}
      </div>
    </div>
  );
}

function IssueList({ issues }: { issues: ValidationIssue[] }) {
  return (
    <div className="space-y-1.5">
      {issues.map((issue, i) => {
        const isError = issue.level === "error";
        const Icon = isError ? CircleAlert : AlertTriangle;
        return (
          <div
            key={i}
            className={`flex items-start gap-2 rounded-md border px-2.5 py-2 text-[12px] leading-snug ${
              isError
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : "border-[hsl(var(--cat-control)/0.3)] bg-[hsl(var(--cat-control)/0.1)] text-[hsl(var(--cat-control))]"
            }`}
          >
            <Icon size={14} className="mt-0.5 shrink-0" />
            <span className="min-w-0">{issue.message}</span>
          </div>
        );
      })}
    </div>
  );
}

function FieldRow({
  spec,
  value,
  hint,
  nodeId,
  flows,
  onUpdate,
}: {
  spec: FieldSpec;
  value: unknown;
  hint?: string;
  nodeId: string;
  flows: FlowRef[];
  onUpdate: (id: string, patch: Record<string, unknown>) => void;
}) {
  const required = !spec.optional && isEmpty(value);
  return (
    <div className="block">
      <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium">
        {fieldLabel(spec.key)}
        {spec.optional ? (
          <span className="text-[10px] font-normal text-muted-foreground">optional</span>
        ) : required ? (
          <span className="rounded bg-destructive/10 px-1 text-[10px] font-normal text-destructive">required</span>
        ) : null}
      </div>
      <FieldControl
        spec={spec}
        value={value}
        flows={flows}
        onChange={(v) => onUpdate(nodeId, { [spec.key]: v })}
      />
      {hint ? <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
