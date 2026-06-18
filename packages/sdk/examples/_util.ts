import { pathToFileURL } from "node:url";
import type { ValidationIssue } from "@construct/dsl";

/** Minimal surface used by example scripts — avoids self-importing `@construct/sdk`. */
export interface FlowReport {
  readonly id: string;
  readonly name: string;
  toJSON(): unknown;
  validate(): ValidationIssue[];
}

/** True when this module is the node entrypoint (not imported by validate-all). */
export function isMain(importMetaUrl: string): boolean {
  const entry = process.argv[1];
  return Boolean(entry && importMetaUrl === pathToFileURL(entry).href);
}

/** Print canonical DSL JSON and fail the process on validation errors. */
export function printFlowReport(flow: FlowReport): void {
  console.log(JSON.stringify(flow.toJSON(), null, 2));

  const issues = flow.validate();
  const errors = issues.filter((i) => i.level === "error");
  if (errors.length > 0) {
    console.error(`\n${errors.length} validation error(s):`);
    for (const e of errors) {
      console.error(`  - [${e.nodeId ?? e.edgeId ?? "flow"}] ${e.message}`);
    }
    process.exit(1);
  }

  const warnings = issues.filter((i) => i.level === "warning");
  if (warnings.length > 0) {
    console.warn(`\n${warnings.length} warning(s):`);
    for (const w of warnings) {
      console.warn(`  - [${w.nodeId ?? w.edgeId ?? "flow"}] ${w.message}`);
    }
  }
}
