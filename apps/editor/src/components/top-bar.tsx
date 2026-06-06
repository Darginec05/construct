import { Moon, Sun } from "lucide-react";
import { useTheme } from "../lib/use-theme.ts";

export type ViewMode = "canvas" | "reader";

const segCls = (active: boolean) =>
  `rounded-md px-3 py-1 text-[12px] font-medium transition ${
    active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
  }`;

export function TopBar({
  view,
  onViewChange,
}: {
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
}) {
  const { theme, toggle } = useTheme();

  return (
    <header className="flex items-center gap-3 border-b border-border px-4">
      <span className="text-sm font-semibold tracking-tight">Construct</span>

      <div className="ml-4 flex items-center gap-0.5 rounded-lg bg-secondary p-0.5">
        <button type="button" className={segCls(view === "canvas")} onClick={() => onViewChange("canvas")}>
          Canvas
        </button>
        <button type="button" className={segCls(view === "reader")} onClick={() => onViewChange("reader")}>
          Reader
        </button>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          aria-label="Toggle theme"
          className="flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-accent"
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>
    </header>
  );
}
