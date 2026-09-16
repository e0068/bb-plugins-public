// Layer 1 — the panel's sections: what each is called and whether it can
// create a new item. Pure data.
//
// One table serves both places a section's name shows up — the rail and the
// header above its list. As two literals they had already drifted: the rail
// said "Plugins", the header "Claude Code plugins".

/**
 * What a section's "+" creates. A section whose items can't be created from
 * this panel has none, and gets no "+" — a permanently disabled button
 * explains nothing (memory/decisions/plus-button-only-where-creation-exists).
 */
export type CreateKind = "hook" | "skill" | "agent" | "workflow";

export interface SectionSpec {
  id: SectionId;
  /** Title for the rail and the section header alike. */
  title: string;
  create: CreateKind | null;
}

// Plugins come from the Claude Code marketplace, connectors from .mcp.json,
// settings from a fixed catalog — nothing to create for those three here.
export const SECTION_SPECS = [
  { id: "hooks", title: "Hooks", create: "hook" },
  { id: "plugins", title: "Plugins", create: null },
  { id: "connectors", title: "Connectors", create: null },
  { id: "skills", title: "Skills", create: "skill" },
  { id: "agents", title: "Agents", create: "agent" },
  { id: "workflows", title: "Workflows", create: "workflow" },
  { id: "settings", title: "Settings", create: null },
] as const satisfies readonly { id: string; title: string; create: CreateKind | null }[];

export type SectionId = (typeof SECTION_SPECS)[number]["id"];

/** Label for the "+" button — its accessible name. */
export const CREATE_LABEL: Record<CreateKind, string> = {
  hook: "New hook",
  skill: "New skill",
  agent: "New agent",
  workflow: "New workflow",
};

/** Total over SectionId: every id comes from the table above. */
export function sectionSpec(id: SectionId): SectionSpec {
  return SECTION_SPECS.find((spec) => spec.id === id) as SectionSpec;
}

export function isSectionId(value: unknown): value is SectionId {
  return SECTION_SPECS.some((spec) => spec.id === value);
}
