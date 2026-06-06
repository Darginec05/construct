import { parseFlow, validateFlow, type Flow } from "../dist/index.js";
import { ALL_FLOWS } from "./references.js";

/** Run every reference flow through parse + validate and print a report. */
function check(name: string, flow: Flow): number {
  let parsed: Flow;
  try {
    parsed = parseFlow(flow);
  } catch (err) {
    console.log(`\n## ${name}\n  STRUCTURAL PARSE FAILED: ${String(err)}`);
    return 1;
  }

  const issues = validateFlow(parsed);
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");

  console.log(`\n## ${name}  (${errors.length} errors, ${warnings.length} warnings)`);
  for (const i of issues) {
    const where = i.nodeId ?? i.edgeId ?? "flow";
    console.log(`  [${i.level}] ${where}: ${i.message}`);
  }
  return errors.length;
}

let totalErrors = 0;
for (const [name, flow] of Object.entries(ALL_FLOWS)) {
  totalErrors += check(name, flow);
}

console.log(`\n=== total error-level issues: ${totalErrors} ===`);
