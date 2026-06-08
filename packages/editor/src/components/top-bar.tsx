import { useMemo, useState } from "react";
import type { ValidationIssue } from "@construct/dsl";
import {
  AlertTriangle,
  Check,
  CircleAlert,
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
import { usePublish } from "../flow/publish-context.tsx";
import { useRun } from "../flow/run-context.tsx";
import type { PublishStatus } from "../flow/types.ts";
import { useValidation } from "../flow/validation-context.tsx";
import { useWorkspace } from "../flow/workspace-context.tsx";
import { EXAMPLES } from "../lib/examples.ts";
import { useTheme } from "../lib/use-theme.ts";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select.tsx";
import { ToggleGroup, ToggleItem } from "./ui/toggle-group.tsx";

export type ViewMode = "canvas" | "reader";

const segItem =
  "inline-flex items-center gap-1.5 rounded-md px-3 data-[pressed]:bg-card data-[pressed]:text-foreground data-[pressed]:shadow-sm data-[pressed]:hover:bg-card hover:bg-transparent";

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
  const [exampleSel, setExampleSel] = useState<string | null>(null);
  const {
    activeFlow,
    activeFlowId,
    renameFlow,
    loadWorkspace,
    focusNode,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useWorkspace();
  const { issues } = useValidation();
  const { runStatus, runActiveFlow } = useRun();
  const { serverConfigured, publishStatus, publishError, publishWorkspace } = usePublish();

  const errors = useMemo(() => issues.filter((i) => i.level === "error").length, [issues]);

  const running = runStatus === "running";

  const focusIssue = (issue: ValidationIssue) => {
    onViewChange("canvas");
    if (issue.nodeId) focusNode(issue.nodeId);
  };

  const onPickExample = (id: string | null) => {
    if (!id) return;
    const example = EXAMPLES.find((e) => e.id === id);
    setExampleSel(null);
    if (!example) return;
    const ok = window.confirm(
      `Загрузить пример «${example.name}»? Текущий workspace будет заменён.`,
    );
    if (ok) loadWorkspace(structuredClone(example.flows));
  };

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

      {/* <Select value={exampleSel} onValueChange={(v: string | null) => onPickExample(v)}>
        <SelectTrigger className="ml-2 h-8 w-[148px] text-[12px]" title="Load a ready-made example">
          <SelectValue placeholder="Examples" />
        </SelectTrigger>
        <SelectContent>
          {EXAMPLES.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select> */}

      <ToggleGroup
        value={[view]}
        onValueChange={(next: string[]) => {
          const v = next[0];
          if (v) onViewChange(v as ViewMode);
        }}
        className="ml-3 rounded-lg border-0 bg-secondary p-0.5"
      >
        <ToggleItem value="canvas" className={segItem}>
          <Workflow size={13} /> Canvas
        </ToggleItem>
        <ToggleItem value="reader" className={segItem}>
          <Layers size={13} /> Reader
        </ToggleItem>
      </ToggleGroup>

      <div className="ml-auto flex items-center gap-1.5">
        <ValidationPanel issues={issues} onFocus={focusIssue} />

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

function ValidationPanel({
  issues,
  onFocus,
}: {
  issues: ValidationIssue[];
  onFocus: (issue: ValidationIssue) => void;
}) {
  const [open, setOpen] = useState(false);
  const errors = issues.filter((i) => i.level === "error").length;
  const warnings = issues.length - errors;

  if (issues.length === 0) {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-[hsl(var(--cat-tool)/0.12)] px-2.5 py-1 text-[11px] font-medium text-[hsl(var(--cat-tool))]">
        <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--cat-tool))]" />
        valid
      </span>
    );
  }

  const pillClass =
    errors > 0
      ? "bg-destructive/10 text-destructive"
      : "bg-[hsl(var(--cat-control)/0.12)] text-[hsl(var(--cat-control))]";
  const dotClass = errors > 0 ? "bg-destructive" : "bg-[hsl(var(--cat-control))]";
  const label =
    errors > 0
      ? `${errors} issue${errors === 1 ? "" : "s"}`
      : `${warnings} warning${warnings === 1 ? "" : "s"}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring ${pillClass}`}
        title="Show validation issues"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
        {label}
      </PopoverTrigger>
      <PopoverContent className="max-h-[320px] w-[340px] overflow-y-auto p-1.5">
        <div className="px-1.5 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {errors > 0 ? `${errors} error${errors === 1 ? "" : "s"}` : ""}
          {errors > 0 && warnings > 0 ? " · " : ""}
          {warnings > 0 ? `${warnings} warning${warnings === 1 ? "" : "s"}` : ""}
        </div>
        {issues.map((issue, i) => {
          const isError = issue.level === "error";
          const Icon = isError ? CircleAlert : AlertTriangle;
          const where = issue.nodeId
            ? `node: ${issue.nodeId}`
            : issue.edgeId
              ? `edge: ${issue.edgeId}`
              : "flow";
          return (
            <button
              key={i}
              type="button"
              onClick={() => {
                onFocus(issue);
                setOpen(false);
              }}
              disabled={!issue.nodeId}
              className="flex w-full items-start gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent"
            >
              <Icon
                size={14}
                className={`mt-0.5 shrink-0 ${isError ? "text-destructive" : "text-[hsl(var(--cat-control))]"}`}
              />
              <span className="min-w-0">
                <span className="block text-[12px] leading-snug">{issue.message}</span>
                <span className="block text-[11px] text-muted-foreground">{where}</span>
              </span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
