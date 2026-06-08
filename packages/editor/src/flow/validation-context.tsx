import { createContext, useContext, useMemo } from "react";
import { validateFlow, type ValidationIssue } from "@construct/dsl";
import { toDslFlow } from "./serialize.ts";
import { useWorkspace } from "./workspace-context.tsx";

interface ValidationStore {
  issues: ValidationIssue[];
  issuesByNode: Record<string, ValidationIssue[]>;
}

const ValidationCtx = createContext<ValidationStore | null>(null);

export function ValidationProvider({ children }: { children: React.ReactNode }) {
  const { activeFlow } = useWorkspace();

  const issues = useMemo(() => validateFlow(toDslFlow(activeFlow)), [activeFlow]);
  const issuesByNode = useMemo(() => {
    const map: Record<string, ValidationIssue[]> = {};
    for (const i of issues) {
      if (i.nodeId) (map[i.nodeId] ??= []).push(i);
    }
    return map;
  }, [issues]);

  const value = useMemo<ValidationStore>(() => ({ issues, issuesByNode }), [issues, issuesByNode]);

  return <ValidationCtx.Provider value={value}>{children}</ValidationCtx.Provider>;
}

export function useValidation(): ValidationStore {
  const ctx = useContext(ValidationCtx);
  if (!ctx) throw new Error("useValidation must be used within ValidationProvider");
  return ctx;
}
