import { useEffect, useRef, useState } from "react";
import { Send, Sparkles } from "lucide-react";
import { Markdown } from "./markdown.tsx";

interface Msg {
  role: "ai" | "user";
  text: string;
}

const SEED: Msg[] = [
  {
    role: "ai",
    text: "I read and edit your flow for you. The Copilot runs in **Construct Cloud** — connect a workspace to enable AI edits. This OSS build ships the editor itself.",
  },
];

const CHIPS = ["Add a guardrail before a tool", "Explain this flow", "Add an error path", "Swap router to a Switch"];

export function Copilot() {
  const [msgs, setMsgs] = useState<Msg[]>(SEED);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  const send = (text?: string) => {
    const t = (text ?? draft).trim();
    if (!t) return;
    setDraft("");
    setMsgs((m) => [
      ...m,
      { role: "user", text: t },
      { role: "ai", text: "Not connected — the Copilot runs in **Construct Cloud**. Link a workspace to apply AI edits to the canvas." },
    ]);
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-3">
        {msgs.map((m, i) => (
          <div key={i} className="flex gap-2.5">
            <div
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold ${
                m.role === "ai" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"
              }`}
            >
              {m.role === "ai" ? <Sparkles size={13} /> : "Y"}
            </div>
            <div className="min-w-0">
              <div className="mb-0.5 text-[11px] font-medium text-muted-foreground">
                {m.role === "ai" ? "Copilot" : "You"}
              </div>
              <Markdown text={m.text} />
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-border p-3">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {CHIPS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setDraft(c)}
              className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {c}
            </button>
          ))}
        </div>
        <div className="rounded-lg border border-input bg-background p-2">
          <textarea
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask the copilot to build or change the flow…"
            className="w-full resize-none bg-transparent text-[13px] outline-none"
          />
          <div className="flex items-center gap-2">
            <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              @node
            </span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => send()}
              className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-foreground"
            >
              <Send size={13} /> Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
