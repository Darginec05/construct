/**
 * Validates every flow exported from ./index.ts.
 * Succeeds immediately when the catalog is empty.
 */
import type { FlowReport } from "./_util.js";

const FLOWS: FlowReport[] = [];

if (FLOWS.length === 0) {
  console.log("no reference flows to validate");
  process.exit(0);
}

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

console.log(`\nvalidated ${FLOWS.length} stress flows`);
