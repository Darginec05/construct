import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import { resolveNodeOutputs } from "@construct/dsl";
import type { HumanDecision, RunEvent } from "@construct/engine";
import { executeFlow } from "../lib/runtime.ts";
import { useConstructClient } from "./client-context.tsx";
import { toDslFlow } from "./serialize.ts";
import type { NodeRunState, PendingHuman, RunMode, RunStatus } from "./types.ts";
import { useWorkspace } from "./workspace-context.tsx";

interface RunStore {
  runStatus: RunStatus;
  runMode: RunMode;
  setRunMode: (mode: RunMode) => void;
  nodeRun: Record<string, NodeRunState>;
  trace: RunEvent[];
  /** Streamed `token` text accumulated per node during a run. */
  streamByNode: Record<string, string>;
  /** A human node awaiting an inline approve/reject decision (sandbox runs). */
  pendingHuman: PendingHuman | null;
  /** Resolve the pending human pause by following one of its exit handles. */
  resolveHuman: (handle: string) => void;
  runOutput: unknown;
  runError: string | null;
  inputValues: Record<string, string>;
  setInputValue: (key: string, value: string) => void;
  runActiveFlow: () => Promise<void>;
  clearRun: () => void;
  serverConfigured: boolean;
}

const RunCtx = createContext<RunStore | null>(null);

export function RunProvider({ children }: { children: React.ReactNode }) {
  const { activeFlow, flows, epoch } = useWorkspace();
  const client = useConstructClient();

  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  // Default to Server when one is configured, so a real run is the obvious path;
  // Sandbox (fake echo, no keys) stays available as a deliberate choice.
  const [runMode, setRunMode] = useState<RunMode>(client !== null ? "server" : "sandbox");
  const [nodeRun, setNodeRun] = useState<Record<string, NodeRunState>>({});
  const [trace, setTrace] = useState<RunEvent[]>([]);
  const [streamByNode, setStreamByNode] = useState<Record<string, string>>({});
  const [pendingHuman, setPendingHuman] = useState<PendingHuman | null>(null);
  // Resolver for the in-flight `onHuman` promise; set while a sandbox run is
  // paused at a human node, cleared when the decision is made or the run aborts.
  const humanResolveRef = useRef<((d: HumanDecision) => void) | null>(null);
  // Per-run token; flipping `aborted` makes a stale run's terminal setters no-op.
  const runTokenRef = useRef<{ aborted: boolean } | null>(null);
  const [runOutput, setRunOutput] = useState<unknown>(undefined);
  const [runError, setRunError] = useState<string | null>(null);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});

  // Keep a live snapshot so run callbacks always see the latest graph + inputs
  // without re-creating on every keystroke.
  const snapRef = useRef({ activeFlow, flows, inputValues, runMode, client });
  snapRef.current = { activeFlow, flows, inputValues, runMode, client };

  const setInputValue = useCallback((key: string, value: string) => {
    setInputValues((v) => ({ ...v, [key]: value }));
  }, []);

  // Abort any in-flight run and release a pending human pause. The empty handle
  // matches no edge, so the abandoned engine run unwinds and its (token-guarded)
  // terminal setters are skipped.
  const abortRun = useCallback(() => {
    if (runTokenRef.current) runTokenRef.current.aborted = true;
    const resolve = humanResolveRef.current;
    humanResolveRef.current = null;
    setPendingHuman(null);
    resolve?.({ handle: "" });
  }, []);

  const resolveHuman = useCallback((handle: string) => {
    const resolve = humanResolveRef.current;
    humanResolveRef.current = null;
    setPendingHuman(null);
    resolve?.({ handle });
  }, []);

  const clearRun = useCallback(() => {
    abortRun();
    setRunStatus("idle");
    setNodeRun({});
    setTrace([]);
    setStreamByNode({});
    setRunOutput(undefined);
    setRunError(null);
  }, [abortRun]);

  // Loading a fresh workspace bumps the epoch; reset run + input state to match
  // the new graph. Layout effect so the reset commits before the browser paints
  // the new graph — the original atomic clear never showed stale run output.
  // The initial epoch is skipped so a fresh mount stays idle.
  const initialEpoch = useRef(epoch);
  useLayoutEffect(() => {
    if (epoch === initialEpoch.current) return;
    clearRun();
    setInputValues({});
  }, [epoch, clearRun]);

  const runActiveFlow = useCallback(async () => {
    const { activeFlow, flows, inputValues, runMode, client } = snapRef.current;
    abortRun();
    const token = { aborted: false };
    runTokenRef.current = token;
    setRunStatus("running");
    setNodeRun({});
    setTrace([]);
    setStreamByNode({});
    setRunOutput(undefined);
    setRunError(null);

    const inputNode = activeFlow.nodes.find((n) => n.data.type === "input");
    const schema = (inputNode?.data.config.schema as Record<string, string> | undefined) ?? {};
    const input: Record<string, unknown> = {};
    for (const [key, type] of Object.entries(schema)) {
      const raw = inputValues[key] ?? "";
      input[key] = type.includes("number") ? Number(raw) : raw;
    }

    const onEvent = (event: RunEvent) => {
      if (token.aborted) return;
      setTrace((t) => [...t, event]);
      if (event.nodeId == null) return;
      const id = event.nodeId;
      if (event.type === "node-start") setNodeRun((m) => ({ ...m, [id]: "running" }));
      else if (event.type === "node-finish") setNodeRun((m) => ({ ...m, [id]: "done" }));
      else if (event.type === "error") setNodeRun((m) => ({ ...m, [id]: "error" }));
      else if (event.type === "token" && typeof event.data === "string") {
        const chunk = event.data;
        setStreamByNode((m) => ({ ...m, [id]: (m[id] ?? "") + chunk }));
      }
    };

    // Inline human approval: hold the run open on a promise the UI resolves when
    // the user picks an exit. Sandbox-only — server runs pause durably instead.
    const onHuman = (node: { id: string; type: string; config: Record<string, unknown> }) =>
      new Promise<HumanDecision>((resolve) => {
        humanResolveRef.current = resolve;
        setPendingHuman({ nodeId: node.id, exits: resolveNodeOutputs(node.type, node.config) });
      });

    try {
      if (runMode === "server" && client) {
        // Real provider calls happen server-side; subflows resolve from the
        // server's store, so a multi-flow workspace must be published first.
        const record = await client.runStream(toDslFlow(activeFlow), input, onEvent);
        if (token.aborted) return;
        setRunStatus(record.status);
        setRunOutput(record.output);
        setRunError(record.error ?? null);
      } else {
        const result = await executeFlow(activeFlow, flows, input, onEvent, onHuman);
        if (token.aborted) return;
        setRunStatus(result.status);
        setRunOutput(result.output);
        setRunError(result.error ?? null);
      }
    } catch (err) {
      if (token.aborted) return;
      setRunStatus("failed");
      setRunError(err instanceof Error ? err.message : String(err));
    }
  }, [abortRun]);

  const value = useMemo<RunStore>(
    () => ({
      runStatus,
      runMode,
      setRunMode,
      nodeRun,
      trace,
      streamByNode,
      pendingHuman,
      resolveHuman,
      runOutput,
      runError,
      inputValues,
      setInputValue,
      runActiveFlow,
      clearRun,
      serverConfigured: client !== null,
    }),
    [
      client,
      runStatus,
      runMode,
      nodeRun,
      trace,
      streamByNode,
      pendingHuman,
      resolveHuman,
      runOutput,
      runError,
      inputValues,
      setInputValue,
      runActiveFlow,
      clearRun,
    ],
  );

  return <RunCtx.Provider value={value}>{children}</RunCtx.Provider>;
}

export function useRun(): RunStore {
  const ctx = useContext(RunCtx);
  if (!ctx) throw new Error("useRun must be used within RunProvider");
  return ctx;
}
