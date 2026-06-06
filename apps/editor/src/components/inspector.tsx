import { useState } from "react";
import { catalogEntry } from "../lib/catalog.ts";
import { describeSchema, type FieldSpec } from "../lib/zod-introspect.ts";
import { useFlow } from "../flow/flow-context.tsx";

const inputCls =
  "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-[13px] outline-none focus:ring-2 focus:ring-ring";

interface FieldProps {
  spec: FieldSpec;
  value: unknown;
  onChange: (value: unknown) => void;
}

function asText(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function JsonField({ spec, value, onChange }: FieldProps) {
  const [text, setText] = useState(() => JSON.stringify(value ?? spec.default ?? null, null, 2));
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <textarea
        rows={4}
        value={text}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          try {
            onChange(JSON.parse(next));
            setError(null);
          } catch {
            setError("invalid JSON");
          }
        }}
        className={`${inputCls} font-mono`}
        spellCheck={false}
      />
      {error ? <div className="mt-1 text-[11px] text-destructive">{error}</div> : null}
    </div>
  );
}

function Field({ spec, value, onChange }: FieldProps) {
  switch (spec.kind) {
    case "textarea":
      return (
        <textarea
          rows={3}
          value={asText(value ?? spec.default)}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
        />
      );
    case "number":
      return (
        <input
          type="number"
          value={asText(value ?? spec.default)}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          className={inputCls}
        />
      );
    case "boolean":
      return (
        <label className="inline-flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={Boolean(value ?? spec.default)}
            onChange={(e) => onChange(e.target.checked)}
          />
          {Boolean(value ?? spec.default) ? "on" : "off"}
        </label>
      );
    case "enum":
      return (
        <select
          value={asText(value ?? spec.default)}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
        >
          {spec.optional ? <option value="">—</option> : null}
          {spec.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case "string-list": {
      const list = Array.isArray(value) ? (value as string[]) : ((spec.default as string[]) ?? []);
      return (
        <textarea
          rows={3}
          value={list.join("\n")}
          onChange={(e) =>
            onChange(
              e.target.value
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
          placeholder="one per line"
          className={inputCls}
        />
      );
    }
    case "json":
      return <JsonField spec={spec} value={value} onChange={onChange} />;
    default:
      return (
        <input
          value={asText(value ?? spec.default)}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
        />
      );
  }
}

export function Inspector() {
  const { selectedNode, updateNodeConfig } = useFlow();

  if (!selectedNode) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-muted-foreground">
        Select a node to edit its configuration.
      </div>
    );
  }

  const entry = catalogEntry(selectedNode.data.type);
  const fields = entry ? describeSchema(entry.spec.configSchema) : [];
  const config = selectedNode.data.config;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-3">
        <div className="text-[13px] font-semibold">{entry?.label ?? selectedNode.data.type}</div>
        <div className="font-mono text-[11px] text-muted-foreground">{selectedNode.id}</div>
      </div>
      <div className="flex-1 space-y-3.5 overflow-y-auto p-4">
        {fields.length === 0 ? (
          <div className="text-[13px] text-muted-foreground">No configurable fields.</div>
        ) : (
          fields.map((spec) => (
            <FieldRow
              key={spec.key}
              spec={spec}
              value={config[spec.key]}
              nodeId={selectedNode.id}
              onUpdate={updateNodeConfig}
            />
          ))
        )}
      </div>
    </div>
  );
}

function FieldRow({
  spec,
  value,
  nodeId,
  onUpdate,
}: {
  spec: FieldSpec;
  value: unknown;
  nodeId: string;
  onUpdate: (id: string, patch: Record<string, unknown>) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1.5 text-[12px] font-medium">
        {spec.key}
        {spec.optional ? <span className="text-[10px] text-muted-foreground">optional</span> : null}
      </span>
      <Field spec={spec} value={value} onChange={(v) => onUpdate(nodeId, { [spec.key]: v })} />
    </label>
  );
}
