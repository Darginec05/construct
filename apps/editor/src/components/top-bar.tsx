import { useMemo } from "react";
import { validateFlow } from "@construct/dsl";
import {
  Check,
  Layers,
  Loader2,
  Moon,
  PanelRight,
  Play,
  Redo2,
  Sun,
  Undo2,
  UploadCloud,
  Workflow,
} from "lucide-react";
import { toDslFlow } from "../flow/serialize.ts";
import { type PublishStatus, useFlow } from "../flow/flow-context.tsx";
import { useTheme } from "../lib/use-theme.ts";

export type ViewMode = "canvas" | "reader";

const segCls = (active: boolean) =>
  `flex items-center gap-1.5 rounded-md px-3 py-1 text-[12px] font-medium transition ${
    active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
  }`;

const iconBtn =
  "flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground";

const histBtn =
  "flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

export function TopBar({
  view,
  onViewChange,
  rightCollapsed,
  onToggleRight,
}: {
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  rightCollapsed: boolean;
  onToggleRight: () => void;
}) {
  const { theme, toggle } = useTheme();
  const {
    activeFlow,
    activeFlowId,
    renameFlow,
    runStatus,
    runActiveFlow,
    undo,
    redo,
    canUndo,
    canRedo,
    serverConfigured,
    publishStatus,
    publishError,
    publishWorkspace,
  } = useFlow();

  const { errors, warnings } = useMemo(() => {
    const issues = validateFlow(toDslFlow(activeFlow));
    return {
      errors: issues.filter((i) => i.level === "error").length,
      warnings: issues.filter((i) => i.level === "warning").length,
    };
  }, [activeFlow]);

  const running = runStatus === "running";

  return (
    <header className="flex items-center gap-2 border-b border-border px-3">
      <div className="flex items-center gap-2">
        <img src="/brand/favicon.svg" alt="Construct" width={24} height={24} className="h-6 w-6 rounded-md" />
        <span className="text-sm font-semibold tracking-tight">Construct</span>
      </div>

      <div className="mx-1 h-5 w-px bg-border" />

      <div className="flex items-center gap-1.5 text-[13px]">
        <span className="text-muted-foreground">Workspace</span>
        <span className="text-muted-foreground">/</span>
        <input
          value={activeFlow.name}
          onChange={(e) => renameFlow(activeFlowId, e.target.value)}
          className="w-36 rounded-md border border-transparent bg-transparent px-1.5 py-1 font-medium outline-none hover:border-border focus:border-input focus:ring-2 focus:ring-ring"
        />
        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          draft
        </span>
      </div>

      <div className="ml-3 flex items-center gap-0.5 rounded-lg bg-secondary p-0.5">
        <button type="button" className={segCls(view === "canvas")} onClick={() => onViewChange("canvas")}>
          <Workflow size={13} /> Canvas
        </button>
        <button type="button" className={segCls(view === "reader")} onClick={() => onViewChange("reader")}>
          <Layers size={13} /> Reader
        </button>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <ValidationPill errors={errors} warnings={warnings} />

        <button
          type="button"
          onClick={undo}
          disabled={!canUndo}
          title="Undo (⌘Z)"
          className={histBtn}
        >
          <Undo2 size={16} />
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={!canRedo}
          title="Redo (⇧⌘Z)"
          className={histBtn}
        >
          <Redo2 size={16} />
        </button>

        <div className="mx-0.5 h-5 w-px bg-border" />

        <button
          type="button"
          onClick={runActiveFlow}
          disabled={running || errors > 0}
          title={errors > 0 ? "Fix validation errors to run" : "Run in the sandbox (simulated model)"}
          className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          {running ? "Running…" : "Run"}
        </button>
        <PublishButton
          serverConfigured={serverConfigured}
          status={publishStatus}
          error={publishError}
          hasErrors={errors > 0}
          onPublish={publishWorkspace}
        />

        <button type="button" onClick={onToggleRight} aria-label="Toggle inspector" className={iconBtn} title="Toggle inspector">
          <PanelRight size={17} className={rightCollapsed ? "opacity-60" : ""} />
        </button>
        <button type="button" onClick={toggle} aria-label="Toggle theme" className={iconBtn} title="Toggle theme">
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </header>
  );
}

function PublishButton({
  serverConfigured,
  status,
  error,
  hasErrors,
  onPublish,
}: {
  serverConfigured: boolean;
  status: PublishStatus;
  error: string | null;
  hasErrors: boolean;
  onPublish: () => void;
}) {
  const publishing = status === "publishing";

  if (!serverConfigured) {
    return (
      <button
        type="button"
        disabled
        aria-disabled="true"
        title="Set VITE_CONSTRUCT_SERVER_URL (apps/editor/.env) to publish to your self-host server"
        className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[12px] font-medium opacity-50"
      >
        <UploadCloud size={14} /> Publish
      </button>
    );
  }

  const title = hasErrors
    ? "Fix validation errors to publish"
    : status === "error" && error
      ? error
      : "Publish the workspace to your self-host server";

  return (
    <button
      type="button"
      onClick={onPublish}
      disabled={publishing || hasErrors}
      title={title}
      className={`flex h-8 items-center gap-1.5 rounded-md border px-3 text-[12px] font-medium transition hover:bg-accent disabled:opacity-50 ${
        status === "error"
          ? "border-destructive/40 text-destructive"
          : "border-border"
      }`}
    >
      {publishing ? (
        <Loader2 size={14} className="animate-spin" />
      ) : status === "done" ? (
        <Check size={14} className="text-[hsl(var(--cat-tool))]" />
      ) : (
        <UploadCloud size={14} />
      )}
      {publishing ? "Publishing…" : status === "done" ? "Published" : "Publish"}
    </button>
  );
}

function ValidationPill({ errors, warnings }: { errors: number; warnings: number }) {
  if (errors > 0) {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 text-[11px] font-medium text-destructive">
        <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
        {errors} issue{errors === 1 ? "" : "s"}
      </span>
    );
  }
  if (warnings > 0) {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-[hsl(var(--cat-control)/0.12)] px-2.5 py-1 text-[11px] font-medium text-[hsl(var(--cat-control))]">
        <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--cat-control))]" />
        {warnings} warning{warnings === 1 ? "" : "s"}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-[hsl(var(--cat-tool)/0.12)] px-2.5 py-1 text-[11px] font-medium text-[hsl(var(--cat-tool))]">
      <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--cat-tool))]" />
      valid
    </span>
  );
}
