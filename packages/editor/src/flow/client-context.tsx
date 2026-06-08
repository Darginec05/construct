import { createContext, useContext } from "react";
import type { ConstructClient } from "@construct/client";

/**
 * The self-host server connection, injected by the host app. The library never
 * reads env (a published bundle must not bake in `VITE_*` keys) — the host owns
 * env and passes a configured client (or `null` for a pure sandbox) down here.
 */
const ClientCtx = createContext<ConstructClient | null>(null);

export function ConstructClientProvider({
  client,
  children,
}: {
  client: ConstructClient | null;
  children: React.ReactNode;
}) {
  return <ClientCtx.Provider value={client}>{children}</ClientCtx.Provider>;
}

export function useConstructClient(): ConstructClient | null {
  return useContext(ClientCtx);
}
