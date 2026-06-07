import { useId, useState } from "react";
import { X } from "lucide-react";
import type { FieldSpec } from "../lib/zod-introspect.ts";
import { EXPR_PLACEHOLDER, fieldLabel } from "../lib/labels.ts";
import { modelPresets } from "../lib/model-presets.ts";

/** Built-in provider ids (a ModelRef.model is a free string per provider). */
const PROVIDERS = ["anthropic", "openai", "gemini", "fake"] as const;

const inputCls =
  "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-[13px] outline-none focus:ring-2 focus:ring-ring";
const selectCls = `${inputCls} cursor-pointer`;

export interface FlowRef {
  id: string;
  name: string;
}

interface ControlProps {
  spec: FieldSpec;
  value: unknown;
  onChange: (value: unknown) => void;
  flows: FlowRef[];
}

function asText(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function PillSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-md border border-input bg-background p-1">
      {options.map((o) => {
        const on = value === o;
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            className={`rounded px-2 py-1 text-[12px] font-medium transition ${
              on
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition ${on ? "bg-primary" : "bg-input"}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-all ${
          on ? "left-[18px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

function TagListField({ value, onChange }: ControlProps) {
  const list = Array.isArray(value) ? (value as string[]) : [];
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    setDraft("");
    if (!t || list.includes(t)) return;
    onChange([...list, t]);
  };
  const remove = (t: string) => onChange(list.filter((x) => x !== t));

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background p-1.5">
      {list.map((t) => (
        <span
          key={t}
          className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[11.5px] text-secondary-foreground"
        >
          {t}
          <button
            type="button"
            onClick={() => remove(t)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && draft === "" && list.length > 0) {
            remove(list[list.length - 1]!);
          }
        }}
        onBlur={add}
        placeholder="add…"
        className="min-w-[60px] flex-1 bg-transparent px-1 text-[12px] outline-none"
      />
    </div>
  );
}

function ModelField({ value, onChange }: ControlProps) {
  const v = asObject(value);
  const listId = useId();
  const presets = modelPresets(v.provider);
  const temp = typeof v.temperature === "number" ? v.temperature : undefined;
  const set = (patch: Record<string, unknown>) => {
    const next = { ...v, ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    onChange(next);
  };
  const clamp = (n: number) => Math.min(2, Math.max(0, n));
  return (
    <div className="space-y-2 rounded-md border border-input bg-background p-2">
      <div>
        <div className="mb-1 text-[11px] text-muted-foreground">provider</div>
        <PillSelect value={asText(v.provider)} options={PROVIDERS} onChange={(p) => set({ provider: p })} />
      </div>
      <div>
        <div className="mb-1 text-[11px] text-muted-foreground">model</div>
        <input
          value={asText(v.model)}
          onChange={(e) => set({ model: e.target.value })}
          placeholder={presets.length ? `e.g. ${presets[0]}` : "model id"}
          list={presets.length ? listId : undefined}
          className={`${inputCls} font-mono`}
        />
        {presets.length ? (
          <datalist id={listId}>
            {presets.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        ) : null}
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>temperature</span>
          <span className="flex items-center gap-2">
            <span className="font-mono">{temp === undefined ? "—" : temp.toFixed(1)}</span>
            {temp !== undefined ? (
              <button type="button" onClick={() => set({ temperature: undefined })} className="hover:text-foreground">
                clear
              </button>
            ) : null}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={2}
          step={0.1}
          value={temp ?? 1}
          onChange={(e) => set({ temperature: clamp(Number(e.target.value)) })}
          className="w-full accent-primary"
        />
      </div>
      <div>
        <div className="mb-1 text-[11px] text-muted-foreground">maxTokens</div>
        <input
          type="number"
          min={1}
          value={v.maxTokens === undefined ? "" : String(v.maxTokens)}
          onChange={(e) => set({ maxTokens: e.target.value === "" ? undefined : Number(e.target.value) })}
          className={inputCls}
        />
      </div>
      <label className="flex items-center justify-between text-[12px]">
        <span className="text-muted-foreground">cache</span>
        <Toggle on={Boolean(v.cache)} onChange={(c) => set({ cache: c || undefined })} />
      </label>
    </div>
  );
}

function ObjectField({ spec, value, onChange, flows }: ControlProps) {
  const obj = asObject(value);
  const set = (key: string, v: unknown) => {
    const next = { ...obj, [key]: v };
    if (v === undefined || v === "") delete next[key];
    onChange(next);
  };
  return (
    <div className="space-y-2 rounded-md border border-input bg-background p-2">
      {(spec.fields ?? []).map((sub) => (
        <div key={sub.key}>
          <div className="mb-1 text-[11px] text-muted-foreground">{fieldLabel(sub.key)}</div>
          <FieldControl spec={sub} value={obj[sub.key]} flows={flows} onChange={(v) => set(sub.key, v)} />
        </div>
      ))}
    </div>
  );
}

function RecordField({ spec, value, onChange }: ControlProps) {
  const obj = asObject(value);
  const entries = Object.entries(obj);
  const emptyVal = spec.recordValue === "datatype" ? (spec.options[0] ?? "text") : "";

  const rebuild = (next: [string, unknown][]) => onChange(Object.fromEntries(next));
  const setKey = (i: number, key: string) =>
    rebuild(entries.map((e, j) => (j === i ? [key, e[1]] : e)));
  const setVal = (i: number, val: unknown) =>
    rebuild(entries.map((e, j) => (j === i ? [e[0], val] : e)));
  const remove = (i: number) => rebuild(entries.filter((_, j) => j !== i));
  const add = () => {
    let key = "field";
    let n = 1;
    while (key in obj) key = `field${n++}`;
    rebuild([...entries, [key, emptyVal]]);
  };

  return (
    <div className="space-y-1.5 rounded-md border border-input bg-background p-1.5">
      {entries.length === 0 ? (
        <div className="px-1 py-0.5 text-[11.5px] text-muted-foreground">No entries.</div>
      ) : (
        entries.map(([key, val], i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              value={key}
              onChange={(e) => setKey(i, e.target.value)}
              placeholder="key"
              className="w-1/3 rounded border border-input bg-background px-1.5 py-1 text-[12px] outline-none focus:ring-1 focus:ring-ring"
            />
            {spec.recordValue === "datatype" ? (
              <select
                value={asText(val)}
                onChange={(e) => setVal(i, e.target.value)}
                className="flex-1 cursor-pointer rounded border border-input bg-background px-1.5 py-1 text-[12px] outline-none focus:ring-1 focus:ring-ring"
              >
                {spec.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={asText(val)}
                onChange={(e) => setVal(i, e.target.value)}
                placeholder="value"
                className="flex-1 rounded border border-input bg-background px-1.5 py-1 font-mono text-[12px] outline-none focus:ring-1 focus:ring-ring"
              />
            )}
            <button
              type="button"
              onClick={() => remove(i)}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <X size={13} />
            </button>
          </div>
        ))
      )}
      <button
        type="button"
        onClick={add}
        className="w-full rounded border border-dashed border-border px-2 py-1 text-[11.5px] text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        + Add field
      </button>
    </div>
  );
}

function JsonField({ spec, value, onChange }: ControlProps) {
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

function FlowRefField({ value, onChange, flows }: ControlProps) {
  const v = asText(value);
  const known = flows.some((f) => f.id === v);
  return (
    <select value={v} onChange={(e) => onChange(e.target.value)} className={selectCls}>
      <option value="">—</option>
      {!known && v ? <option value={v}>{v}</option> : null}
      {flows.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name} · {f.id}
        </option>
      ))}
    </select>
  );
}

function UnionField(props: ControlProps) {
  const { spec, value, onChange } = props;
  if (spec.union === "text-or-structured") {
    const structured = value != null && typeof value === "object";
    return (
      <div className="space-y-2">
        <PillSelect
          value={structured ? "structured" : "text"}
          options={["text", "structured"]}
          onChange={(m) => onChange(m === "text" ? "text" : { schema: {} })}
        />
        {structured ? <JsonField {...props} /> : null}
      </div>
    );
  }
  if (spec.union === "expr-or-record") {
    const bundle = value != null && typeof value === "object";
    return (
      <div className="space-y-2">
        <PillSelect
          value={bundle ? "bundle" : "single"}
          options={["single", "bundle"]}
          onChange={(m) => onChange(m === "single" ? "" : {})}
        />
        {bundle ? (
          <RecordField {...props} spec={{ ...spec, recordValue: "expr" }} />
        ) : (
          <input
            value={asText(value)}
            onChange={(e) => onChange(e.target.value)}
            placeholder="$.result"
            className={`${inputCls} font-mono`}
          />
        )}
      </div>
    );
  }
  return <JsonField {...props} />;
}

export function FieldControl(props: ControlProps) {
  const { spec, value, onChange } = props;
  switch (spec.kind) {
    case "textarea":
      return (
        <textarea
          rows={spec.mono ? 6 : 3}
          value={asText(value ?? spec.default)}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputCls} ${spec.mono ? "font-mono" : ""}`}
        />
      );
    case "number":
      return (
        <input
          type="number"
          min={spec.min}
          step={spec.int ? 1 : "any"}
          value={asText(value ?? spec.default)}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          className={inputCls}
        />
      );
    case "boolean":
      return <Toggle on={Boolean(value ?? spec.default)} onChange={onChange} />;
    case "enum":
      return (
        <PillSelect
          value={asText(value ?? spec.default)}
          options={spec.options}
          onChange={onChange}
        />
      );
    case "string-list":
      return <TagListField {...props} />;
    case "model":
      return <ModelField {...props} />;
    case "record":
      return <RecordField {...props} />;
    case "object":
      return <ObjectField {...props} />;
    case "union":
      return <UnionField {...props} />;
    case "json":
      return <JsonField {...props} />;
    default:
      if (spec.ref === "flow") return <FlowRefField {...props} />;
      return (
        <input
          value={asText(value ?? spec.default)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={spec.mono ? EXPR_PLACEHOLDER : undefined}
          className={`${inputCls} ${spec.mono ? "font-mono" : ""}`}
        />
      );
  }
}
