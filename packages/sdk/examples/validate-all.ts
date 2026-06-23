/**
 * Validates every flow exported from ./index.ts.
 */
import { launchAnnouncement } from "./launch-announcement.js";
import type { FlowReport } from "./_util.js";

const FLOWS: FlowReport[] = [launchAnnouncement];

let failed = false;

for (const flow of FLOWS) {
  const errors = flow.validate().filter((i) => i.level === "error");
  if (errors.length > 0) {
    failed = true;
    console.error(`\n${flow.id}: ${errors.length} validation error(s)`);
    for (const e of errors) {
      console.error(`  - [${e.nodeId ?? e.edgeId ?? "flow"}] ${e.message}`);
    }
    continue;
  }
  console.log(`ok  ${flow.id} (${flow.name})`);
}

if (failed) process.exit(1);

console.log(`\nvalidated ${FLOWS.length} reference flow(s)`);
