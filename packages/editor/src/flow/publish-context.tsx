import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useConstructClient } from "./client-context.tsx";
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
  const client = useConstructClient();
  const [publishStatus, setPublishStatus] = useState<PublishStatus>("idle");
  const [publishError, setPublishError] = useState<string | null>(null);

  const flowsRef = useRef(flows);
  flowsRef.current = flows;
  const clientRef = useRef(client);
  clientRef.current = client;

  const publishWorkspace = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    setPublishStatus("publishing");
    setPublishError(null);
    try {
      // Push every flow in the workspace so referenced subflows land too.
      for (const f of flowsRef.current) {
        await client.saveFlow(toDslFlow(f), { id: f.id, name: f.name });
      }
      setPublishStatus("done");
    } catch (err) {
      setPublishStatus("error");
      setPublishError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const value = useMemo<PublishStore>(
    () => ({
      serverConfigured: client !== null,
      publishStatus,
      publishError,
      publishWorkspace,
    }),
    [client, publishStatus, publishError, publishWorkspace],
  );

  return <PublishCtx.Provider value={value}>{children}</PublishCtx.Provider>;
}

export function usePublish(): PublishStore {
  const ctx = useContext(PublishCtx);
  if (!ctx) throw new Error("usePublish must be used within PublishProvider");
  return ctx;
}
