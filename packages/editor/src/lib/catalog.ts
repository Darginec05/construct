import { listNodeSpecs, type NodeCategory, type NodeSpec } from "@construct/dsl";
import {
  Bot,
  Braces,
  Code,
  Database,
  Flag,
  GitBranch,
  Grid3x3,
  type LucideIcon,
  LogIn,
  Merge,
  Repeat,
  Route,
  Split,
  User,
  Workflow,
  Wrench,
} from "lucide-react";

export interface CategoryMeta {
  label: string;
  /** CSS custom property holding the category hue (raw HSL channels). */
  hueVar: string;
}

export const CATEGORY_META: Record<NodeCategory, CategoryMeta> = {
  io: { label: "I/O", hueVar: "--cat-io" },
  model: { label: "Model", hueVar: "--cat-model" },
  control: { label: "Control", hueVar: "--cat-control" },
  data: { label: "Data", hueVar: "--cat-data" },
  tool: { label: "Tools", hueVar: "--cat-tool" },
  human: { label: "Human", hueVar: "--cat-human" },
  composite: { label: "Composite", hueVar: "--cat-composite" },
};

export const CATEGORY_ORDER: readonly NodeCategory[] = [
  "io",
  "model",
  "control",
  "data",
  "tool",
  "human",
  "composite",
];

interface NodePresentation {
  label: string;
  icon: LucideIcon;
}

const PRESENTATION: Record<string, NodePresentation> = {
  input: { label: "Input", icon: LogIn },
  output: { label: "Output", icon: Flag },
  agent: { label: "Agent", icon: Bot },
  router: { label: "Router", icon: Split },
  branch: { label: "Branch", icon: GitBranch },
  switch: { label: "Switch", icon: Route },
  loop: { label: "Loop", icon: Repeat },
  map: { label: "Map", icon: Grid3x3 },
  join: { label: "Join", icon: Merge },
  code: { label: "Code", icon: Code },
  retrieve: { label: "Retrieve", icon: Database },
  transform: { label: "Transform", icon: Braces },
  tool: { label: "Tool", icon: Wrench },
  human: { label: "Human", icon: User },
  subflow: { label: "Subflow", icon: Workflow },
};

/**
 * Node types that are catalogued but not yet usable: shown in the library with a
 * "Soon" badge and not draggable onto the canvas. `code` is parked here because
 * its only runtime path is a host-registered `ref` (no inline execution, which
 * would need a sandbox), so there is nothing for an author to wire yet.
 */
export const COMING_SOON: ReadonlySet<string> = new Set(["code"]);

export function isComingSoon(type: string): boolean {
  return COMING_SOON.has(type);
}

export interface CatalogEntry {
  type: string;
  label: string;
  description: string;
  category: NodeCategory;
  icon: LucideIcon;
  spec: NodeSpec;
  /** Catalogued but not yet usable — rendered disabled with a "Soon" badge. */
  comingSoon: boolean;
}

function present(spec: NodeSpec): CatalogEntry {
  const p = PRESENTATION[spec.type] ?? { label: spec.type, icon: Workflow };
  return {
    type: spec.type,
    label: p.label,
    description: spec.description,
    category: spec.category,
    icon: p.icon,
    spec,
    comingSoon: COMING_SOON.has(spec.type),
  };
}

/** Enriched catalog built from the real DSL registry. */
export const CATALOG: readonly CatalogEntry[] = listNodeSpecs().map(present);

const BY_TYPE = new Map(CATALOG.map((e) => [e.type, e]));

export function catalogEntry(type: string): CatalogEntry | undefined {
  return BY_TYPE.get(type);
}
