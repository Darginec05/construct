import { CircleDot, FlaskConical, Loader2, Play, Plus } from "lucide-react";
import { useFlow } from "../flow/flow-context.tsx";

const inputCls =
  "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-[13px] outline-none focus:ring-2 focus:ring-ring";

export function TestPanel() {
  const {
    nodes,
    runStatus,
    trace,
    runOutput,
    runError,
    inputValues,
    setInputValue,
    runActiveFlow,
  } = useFlow();

  const inputNode = nodes.find((n) => n.data.type === "input");
  const schema = (inputNode?.data.config.schema as Record<string, string> | undefined) ?? {};
  const fields = Object.entries(schema);
  const running = runStatus === "running";

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        <div className="flex items-start gap-2 rounded-md border border-dashed border-border bg-muted/40 px-2.5 py-2 text-[11px] text-muted-foreground">
          <FlaskConical size={14} className="mt-px shrink-0" />
          <span>
            <span className="font-medium text-foreground">Sandbox · simulated model.</span> Runs use
            a fake echo provider — no API calls, no keys.
          </span>
        </div>

        <div>
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Input
          </div>

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
                    value={inputValues[key] ?? ""}
                    onChange={(e) => setInputValue(key, e.target.value)}
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
                    value={inputValues[key] ?? ""}
                    onChange={(e) => setInputValue(key, e.target.value)}
                    placeholder={key}
                    className={inputCls}
                  />
                )}
              </div>
            ))
          )}
        </div>

        {trace.length > 0 ? <Trace /> : null}
        {runError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-[12px] text-destructive">
            {runError}
          </div>
        ) : null}
        {runStatus === "completed" || runStatus === "paused" ? <Output value={runOutput} /> : null}
      </div>

      <div className="border-t border-border p-3">
        <button
          type="button"
          onClick={runActiveFlow}
          disabled={running}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
          {running ? "Running…" : "Run agent"}
        </button>
      </div>
    </div>
  );
}

function Trace() {
  const { trace } = useFlow();
  const steps = trace.filter((e) => e.type === "node-start" || e.type === "node-finish" || e.type === "error");
  return (
    <div>
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Trace
      </div>
      <ol className="space-y-1">
        {steps.map((e, i) => (
          <li key={i} className="flex items-center gap-2 text-[12px]">
            <CircleDot
              size={12}
              className={
                e.type === "error"
                  ? "text-destructive"
                  : e.type === "node-finish"
                    ? "text-[hsl(var(--cat-tool))]"
                    : "text-[hsl(var(--cat-control))]"
              }
            />
            <span className="font-mono text-muted-foreground">{e.nodeId ?? "—"}</span>
            <span className="text-muted-foreground">{e.type.replace("node-", "")}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Output({ value }: { value: unknown }) {
  const text =
    value == null
      ? "(no output)"
      : typeof value === "string"
        ? value
        : JSON.stringify(value, null, 2);
  return (
    <div>
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Output
      </div>
      <pre className="whitespace-pre-wrap rounded-md border border-border bg-muted/40 px-2.5 py-2 text-[12px]">
        {text}
      </pre>
    </div>
  );
}
