import { PublishProvider } from "./publish-context.tsx";
import { RunProvider } from "./run-context.tsx";
import { ValidationProvider } from "./validation-context.tsx";
import { WorkspaceProvider } from "./workspace-context.tsx";

/**
 * Composition root for the editor's flow state. The store is split by domain so
 * consumers subscribe only to what they need (workspace / validation / run /
 * publish) and don't re-render on unrelated changes. Inner providers read outer
 * ones through their hooks, so the nesting order is the dependency order.
 */
export function FlowProvider({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <ValidationProvider>
        <RunProvider>
          <PublishProvider>{children}</PublishProvider>
        </RunProvider>
      </ValidationProvider>
    </WorkspaceProvider>
  );
}
