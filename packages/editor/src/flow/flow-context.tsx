import type { ConstructClient } from "@construct/client";
import { ConstructClientProvider } from "./client-context.tsx";
import type { FlowDoc } from "./types.ts";
import { EditorApiProvider } from "./editor-api-context.tsx";
import { PublishProvider } from "./publish-context.tsx";
import { RunProvider } from "./run-context.tsx";
import { ValidationProvider } from "./validation-context.tsx";
import { WorkspaceProvider } from "./workspace-context.tsx";

type FlowProviderProps = {
  client?: ConstructClient | null;
  initialFlows?: FlowDoc[];
  onFlowChange?: (doc: FlowDoc) => void;
  children: React.ReactNode;
}

/**
 * Composition root for the editor's flow state. The store is split by domain so
 * consumers subscribe only to what they need (workspace / validation / run /
 * publish) and don't re-render on unrelated changes. Inner providers read outer
 * ones through their hooks, so the nesting order is the dependency order.
 *
 * `client` is the host-supplied server connection (run/publish read it through
 * context); `null` keeps the editor a pure sandbox.
 */
export function FlowProvider({
  client = null,
  initialFlows,
  onFlowChange,
  children,
}: FlowProviderProps) {
  return (
    <ConstructClientProvider client={client}>
      <WorkspaceProvider initialFlows={initialFlows} onFlowChange={onFlowChange}>
        <ValidationProvider>
          <EditorApiProvider>
            <RunProvider>
              <PublishProvider>{children}</PublishProvider>
            </RunProvider>
          </EditorApiProvider>
        </ValidationProvider>
      </WorkspaceProvider>
    </ConstructClientProvider>
  );
}
