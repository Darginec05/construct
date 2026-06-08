export { ConstructEditor, type ConstructEditorProps, type EditorSlots } from "./construct-editor.tsx";
export { useEditorApi, type EditorApi } from "./flow/editor-api-context.tsx";
export type { WorkspaceFlow, WorkspaceFlowInput, FlowInput } from "./flow/serialize.ts";

// The copilot facade speaks the canonical DSL contract; re-export the types a
// host needs to type its `useEditorApi()` calls without a direct @construct/dsl dep.
export type { Flow, ValidationIssue } from "@construct/dsl";