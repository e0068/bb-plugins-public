// agents.ts — the agents a step can take as its template, in the shape both consumers hand the builder.
// Pure data: Claude Config lists them from the agents/ directories, Flow from its executor catalog.

// A discovered agent: its agentType value, frontmatter-derived model/effort/provider, and — for the
// Save/Override decision and the tools written back to the agent's .md — its tools list and which agents/
// directory it lives in. "builtin" is the one scope with no source file — a Claude Code agent type the
// consumer pins into the list itself, so Save/Override never applies to it.
export interface AgentOption {
  value: string;
  model: string;
  effort: string;
  provider: string;
  description?: string;
  path?: string;
  tools?: string[];
  scope?: "user" | "project" | "plugin" | "builtin";
}

export interface ProviderCatalogEntry {
  id: string;
  name: string;
  models: { id: string; efforts: string[] }[];
}

// Claude Code agent types with no `.md` file to discover — pinned ahead of the scanned catalog so they're
// always reachable as a template, not lost among alphabetical results.
export const BUILTIN_AGENTS: readonly AgentOption[] = [
  { value: "general-purpose", model: "", effort: "", provider: "", description: "General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks.", scope: "builtin" },
];

/** The built-in agents first, then the discovered ones that don't repeat them. */
export const withBuiltinAgents = (found: readonly AgentOption[]): AgentOption[] => [
  ...BUILTIN_AGENTS,
  ...found.filter((a) => !BUILTIN_AGENTS.some((b) => b.value === a.value)),
];
