import { useState } from "react";
import { Play, Plus } from "lucide-react";
import { useFlow } from "../flow/flow-context.tsx";

const inputCls =
  "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-[13px] outline-none focus:ring-2 focus:ring-ring";

export function TestPanel() {
  const { nodes } = useFlow();
  const inputNode = nodes.find((n) => n.data.type === "input");
  const schema = (inputNode?.data.config.schema as Record<string, string> | undefined) ?? {};
  const fields = Object.entries(schema);
  const [vals, setVals] = useState<Record<string, string>>({});

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto p-3">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Input</div>

        {fields.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-3 py-4 text-[12px] text-muted-foreground">
            No inputs declared. Add fields to the input node's schema to test it.
          </div>
        ) : (
          fields.map(([key, type]) => (
            <div key={key} className="mb-3">
              <label className="mb-1 flex items-center gap-1.5 text-[12px] font-medium">
                {key}
                <span className="font-mono text-[10px] text-muted-foreground">{type}</span>
              </label>
              {type.includes("text") ? (
                <textarea
                  rows={2}
                  value={vals[key] ?? ""}
                  onChange={(e) => setVals((v) => ({ ...v, [key]: e.target.value }))}
                  placeholder={`Enter ${key}…`}
                  className={inputCls}
                />
              ) : type.includes("file") || type.includes("image") || type.includes("audio") ? (
                <button
                  type="button"
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-accent"
                >
                  <Plus size={14} /> Attach {key}
                </button>
              ) : (
                <input
                  value={vals[key] ?? ""}
                  onChange={(e) => setVals((v) => ({ ...v, [key]: e.target.value }))}
                  placeholder={key}
                  className={inputCls}
                />
              )}
            </div>
          ))
        )}
      </div>

      <div className="border-t border-border p-3">
        <button
          type="button"
          disabled
          title="Execution wired in #27 (runtime)"
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground opacity-50"
        >
          <Play size={15} /> Run agent
        </button>
      </div>
    </div>
  );
}
