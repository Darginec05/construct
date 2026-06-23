import { codeReview } from "./code-review.js";
import { contentStudio } from "./content-studio.js";
import { documentIntake } from "./document-intake.js";
import { incidentResponse } from "./incident-response.js";
import { launchAnnouncement } from "./launch-announcement.js";
import { realEstateCrmAgent } from "./real-estate-crm-agent.js";
import { salesOutbound } from "./sales-outbound.js";
import { supervisor } from "./supervisor.js";
import { supportHub } from "./support-hub.js";
import type { FlowReport } from "./_util.js";

const FLOWS: FlowReport[] = [
  launchAnnouncement,
  supportHub,
  documentIntake,
  incidentResponse,
  salesOutbound,
  codeReview,
  supervisor,
  contentStudio,
  realEstateCrmAgent,
];

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
