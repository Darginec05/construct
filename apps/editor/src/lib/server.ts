import { ConstructClient } from "@construct/sdk";

/**
 * Self-host server connection, read from build-time Vite env. Publish targets
 * this server; when `VITE_CONSTRUCT_SERVER_URL` is unset the Publish action is
 * disabled (the editor stays a pure sandbox). Set the vars in `apps/editor/.env`:
 *
 *   VITE_CONSTRUCT_SERVER_URL=http://localhost:8787
 *   VITE_CONSTRUCT_API_KEY=secret   # only if the server requires a token
 */
const rawUrl = import.meta.env.VITE_CONSTRUCT_SERVER_URL as string | undefined;
const rawKey = import.meta.env.VITE_CONSTRUCT_API_KEY as string | undefined;

export const serverUrl: string | null = rawUrl?.trim() ? rawUrl.trim() : null;

export const constructClient: ConstructClient | null = serverUrl
  ? new ConstructClient({ baseUrl: serverUrl, apiKey: rawKey?.trim() || undefined })
  : null;
