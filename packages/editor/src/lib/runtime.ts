import { runFlow, type RunEvent, type RunOptions, type RunResult } from "@construct/engine";
import { createFakeProvider, registerProvider } from "@construct/providers";
// Side-effect import: registers the agent / classifier / tool / retrieve executors.
import "@construct/nodes";
import type { FlowDoc } from "../flow/types.ts";
import { toDslFlow } from "../flow/serialize.ts";

let ready = false;

/**
 * Wire a sandbox runtime once. Every provider id resolves to a fake echo model,
 * so flows run in the browser with no API keys — runs are labelled "simulated".
 */
function ensureRuntime() {
  if (ready) return;
  for (const id of ["fake", "anthropic", "openai", "gemini"]) {
    registerProvider(createFakeProvider({ id }));
  }
  ready = true;
}

export function executeFlow(
  active: FlowDoc,
  all: FlowDoc[],
  input: Record<string, unknown>,
  onEvent: (event: RunEvent) => void,
  onHuman?: RunOptions["onHuman"],
): Promise<RunResult> {
  ensureRuntime();
  const flows = Object.fromEntries(all.map((f) => [f.id, toDslFlow(f)]));
  return runFlow(toDslFlow(active), { input, flows, onEvent, onHuman });
}
