/**
 * Stress-test reference flows for @construct/sdk.
 *
 * Run one:  yarn workspace @construct/sdk exec tsx examples/support-hub.ts
 * Validate all: yarn workspace @construct/sdk smoke
 */
export { supportHub } from "./support-hub.js";
export { documentIntake } from "./document-intake.js";
export { incidentResponse } from "./incident-response.js";
export { salesOutbound } from "./sales-outbound.js";
export { codeReview } from "./code-review.js";
export { supervisor } from "./supervisor.js";
export { contentStudio } from "./content-studio.js";
