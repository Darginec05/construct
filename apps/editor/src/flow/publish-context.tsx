import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { constructClient } from "../lib/server.ts";
import { toDslFlow } from "./serialize.ts";
import type { PublishStatus } from "./types.ts";
import { useWorkspace } from "./workspace-context.tsx";

interface PublishStore {
  serverConfigured: boolean;
  publishStatus: PublishStatus;
  publishError: string | null;
  publishWorkspace: () => Promise<void>;
}

const PublishCtx = createContext<PublishStore | null>(null);

export function PublishProvider({ children }: { children: React.ReactNode }) {
  const { flows } = useWorkspace();
  const [publishStatus, setPublishStatus] = useState<PublishStatus>("idle");
  const [publishError, setPublishError] = useState<string | null>(null);

  const flowsRef = useRef(flows);
  flowsRef.current = flows;

  const publishWorkspace = useCallback(async () => {
    if (!constructClient) return;
    setPublishStatus("publishing");
    setPublishError(null);
    try {
      // Push every flow in the workspace so referenced subflows land too.
      for (const f of flowsRef.current) {
        await constructClient.saveFlow(toDslFlow(f), { id: f.id, name: f.name });
      }
      setPublishStatus("done");
    } catch (err) {
      setPublishStatus("error");
      setPublishError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const value = useMemo<PublishStore>(
    () => ({
      serverConfigured: constructClient !== null,
      publishStatus,
      publishError,
      publishWorkspace,
    }),
    [publishStatus, publishError, publishWorkspace],
  );

  return <PublishCtx.Provider value={value}>{children}</PublishCtx.Provider>;
}

export function usePublish(): PublishStore {
  const ctx = useContext(PublishCtx);
  if (!ctx) throw new Error("usePublish must be used within PublishProvider");
  return ctx;
}
